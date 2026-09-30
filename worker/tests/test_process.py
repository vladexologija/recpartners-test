"""One job end to end (D2, D3a), with real ffmpeg on a generated clip and fake GCS, Pub/Sub
and model."""

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import process as process_module
from app.messages import DoneEvent, FailedEvent, Job, ProgressEvent
from app.pipeline.detector import Box
from app.process import process_job
from tests.conftest import FakeDetector, FakePublisher, FakeStorage


def run(
    clip: Path,
    job: Job,
    publisher: FakePublisher,
    detector: FakeDetector | None = None,
) -> FakeStorage:
    storage = FakeStorage(clip)
    process_job(job, storage, publisher, detector or FakeDetector())
    return storage


def test_a_video_is_processed_into_started_progress_then_done(
    clips: dict[str, Path], job: Job, publisher: FakePublisher
) -> None:
    box = Box(confidence=0.9, x1=0.1, y1=0.2, x2=0.3, y2=0.4)
    weaker = Box(confidence=0.5, x1=0.5, y1=0.5, x2=0.6, y2=0.6)
    run(clips["landscape"], job, publisher, FakeDetector({3: [box, weaker]}))
    assert publisher.types == ["started", "progress", "done"]
    done = publisher.events[-1]
    assert isinstance(done, DoneEvent)
    assert (done.frames_sampled, done.width, done.height, done.codec) == (6, 320, 180, "h264")
    assert [(d.sample_idx, d.det_rank, d.t_seconds, d.confidence) for d in done.detections] == [
        (3, 0, 1.5, 0.9),
        (3, 1, 1.5, 0.5),
    ]


def test_the_video_is_deleted_once_the_job_ends(
    clips: dict[str, Path], job: Job, publisher: FakePublisher
) -> None:
    storage = run(clips["landscape"], job, publisher)
    assert storage.downloaded_to is not None
    assert not storage.downloaded_to.exists()


@pytest.mark.parametrize(
    ("clip", "reason"),
    [("garbage", "Not a valid MP4."), ("audio_only", "The file has no video track.")],
)
def test_a_file_that_cannot_be_processed_fails_with_its_reason(
    clips: dict[str, Path], job: Job, publisher: FakePublisher, clip: str, reason: str
) -> None:
    run(clips[clip], job, publisher)
    assert publisher.types == ["started", "failed"]
    assert publisher.events[-1] == FailedEvent(analysis_id=job.analysis_id, reason=reason)


def test_an_unexpected_error_fails_the_job_without_leaking_details(
    clips: dict[str, Path], job: Job, publisher: FakePublisher
) -> None:
    class BrokenDetector(FakeDetector):
        def detect(self, frames):  # type: ignore[no-untyped-def]
            raise RuntimeError("CUDA out of memory at 0xdeadbeef")

    run(clips["landscape"], job, publisher, BrokenDetector())
    assert publisher.events[-1] == FailedEvent(
        analysis_id=job.analysis_id, reason="Processing failed unexpectedly."
    )


def test_progress_is_reported_and_a_failed_progress_event_is_skipped(
    clips: dict[str, Path], job: Job, publisher: FakePublisher, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(process_module, "PREDICT_BATCH", 2)
    run(clips["landscape"], job, publisher)
    progress = [e.progress for e in publisher.events if isinstance(e, ProgressEvent)]
    assert len(progress) == 3  # one per batch: 6 frames, 2 per batch
    assert progress == sorted(progress)
    assert 0 < progress[0] and progress[-1] < 1  # 1 is reported by `done`
    publisher.events.clear()
    publisher.refuse = {"progress"}
    run(clips["landscape"], job, publisher)
    assert publisher.types == ["started", "done"]


def test_if_even_the_failed_event_cannot_be_published_the_job_is_not_acknowledged(
    clips: dict[str, Path], job: Job, publisher: FakePublisher
) -> None:
    publisher.refuse = {"failed"}
    with pytest.raises(ConnectionError):
        run(clips["garbage"], job, publisher)


# --- The push endpoint --------------------------------------------------------------------


def push(client: TestClient, data: bytes) -> int:
    envelope = {"message": {"data": base64.b64encode(data).decode()}, "subscription": "s"}
    return client.post("/internal/process", json=envelope).status_code


def test_a_pushed_job_is_acknowledged_once_its_final_event_is_published(
    client: TestClient, job: Job, publisher: FakePublisher
) -> None:
    assert push(client, job.model_dump_json().encode()) == 204
    assert publisher.types == ["started", "progress", "done"]


def test_a_malformed_job_is_acknowledged_and_ignored(
    client: TestClient, publisher: FakePublisher
) -> None:
    assert push(client, b'{"analysis_id": "nope"}') == 204
    assert publisher.events == []


def test_a_job_whose_final_event_cannot_be_published_is_redelivered(
    client: TestClient, job: Job, publisher: FakePublisher
) -> None:
    publisher.refuse = {"done", "failed"}
    assert push(client, job.model_dump_json().encode()) == 500  # Pub/Sub delivers it again
