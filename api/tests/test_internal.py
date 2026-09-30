"""The Pub/Sub push handlers (D2, D3, D3a, D9): upload events and the worker's events."""

import base64
import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlmodel import Session

from app.core.streams import streams
from app.models import Analysis, Video
from tests.conftest import FakePublisher, FakeStorage
from tests.test_videos import MB, add_uploaded_video, create_body


def push(
    client: TestClient, path: str, data: object, attributes: dict[str, str] | None = None
) -> Response:
    raw = data if isinstance(data, bytes) else json.dumps(data).encode()
    envelope = {
        "message": {"data": base64.b64encode(raw).decode(), "attributes": attributes or {}},
        "subscription": "projects/p/subscriptions/s",
    }
    return client.post(path, json=envelope)


def upload_landed(client: TestClient, video_id: uuid.UUID, size: int = 5 * MB) -> Response:
    """GCS's OBJECT_FINALIZE notification (JSON_API_V1): numbers arrive as strings."""
    landed = {"name": f"videos/{video_id}.mp4", "size": str(size), "generation": "1712"}
    return push(client, "/internal/gcs-events", landed, {"eventType": "OBJECT_FINALIZE"})


def worker_event(client: TestClient, analysis_id: uuid.UUID, **event: Any) -> Response:
    return push(client, "/internal/analysis-events", {"analysis_id": str(analysis_id), **event})


def done(frames: int = 25, boxes: int = 1) -> dict[str, Any]:
    box = {"t_seconds": 1.5, "confidence": 0.9, "x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4}
    return {
        "type": "done",
        "frames_sampled": frames,
        "duration_s": 12.5,
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "detections": [{"sample_idx": i, "det_rank": 0, **box} for i in range(boxes)],
    }


def state(client: TestClient, video_id: uuid.UUID) -> dict[str, Any]:
    analysis: dict[str, Any] = client.get(f"/api/videos/{video_id}").json()["analysis"]
    return analysis


# --- Upload events ------------------------------------------------------------------------


def test_an_upload_queues_the_analysis_and_publishes_one_job(
    client: TestClient, session: Session, publisher: FakePublisher
) -> None:
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    assert upload_landed(client, video_id).status_code == 204
    assert state(client, video_id)["state"] == "queued"
    video = session.get(Video, video_id)
    assert video is not None
    assert (video.status, video.size_bytes, video.gcs_generation) == ("uploaded", 5 * MB, 1712)
    assert [job.video_id for job in publisher.jobs] == [video_id]


def test_a_redelivered_upload_while_queued_publishes_the_same_job_again(
    client: TestClient, publisher: FakePublisher
) -> None:
    """The handler cannot tell a lost publish from a successful one; a duplicate is harmless."""
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    upload_landed(client, video_id)
    upload_landed(client, video_id)
    assert len(publisher.jobs) == 2
    assert publisher.jobs[0] == publisher.jobs[1]


def test_a_redelivered_upload_after_processing_started_publishes_nothing(
    client: TestClient, publisher: FakePublisher
) -> None:
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    upload_landed(client, video_id)
    worker_event(client, publisher.jobs[0].analysis_id, type="started")
    upload_landed(client, video_id)
    assert len(publisher.jobs) == 1


def test_an_object_that_matches_no_video_is_acknowledged_and_ignored(
    client: TestClient, publisher: FakePublisher
) -> None:
    assert upload_landed(client, uuid.uuid4()).status_code == 204
    assert publisher.jobs == []


def test_an_upload_of_another_size_is_rejected_and_deleted(
    client: TestClient, storage: FakeStorage, publisher: FakePublisher
) -> None:
    """D9, layer 3: a backstop for the signed PUT, which pins the size."""
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    assert upload_landed(client, video_id, size=6 * MB).status_code == 204
    assert state(client, video_id)["state"] == "failed"
    assert "declared size" in state(client, video_id)["error"]
    assert storage.deleted == [f"videos/{video_id}.mp4"]
    assert publisher.jobs == []


def test_other_bucket_events_and_malformed_uploads_are_ignored(
    client: TestClient, publisher: FakePublisher
) -> None:
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    landed = {"name": f"videos/{video_id}.mp4", "size": "1", "generation": "1"}
    deleted = push(client, "/internal/gcs-events", landed, {"eventType": "OBJECT_DELETE"})
    malformed = push(client, "/internal/gcs-events", b"not json", {"eventType": "OBJECT_FINALIZE"})
    assert (deleted.status_code, malformed.status_code) == (204, 204)
    assert state(client, video_id)["state"] == "awaiting_upload"
    assert publisher.jobs == []


# --- The worker's events ------------------------------------------------------------------


def test_done_twice_keeps_one_result_set(client: TestClient, session: Session) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    worker_event(client, analysis.id, **done(boxes=2))
    worker_event(client, analysis.id, **done(boxes=3))  # a duplicate or stale run: ignored
    detections = client.get(f"/api/videos/{video.id}/detections").json()["detections"]
    assert len(detections) == 2
    assert state(client, video.id)["detection_count"] == 2


def test_done_stores_the_probe_results_on_the_video(client: TestClient, session: Session) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    worker_event(client, analysis.id, **done())
    session.expire_all()
    stored = session.get(Video, video.id)
    assert stored is not None
    assert (stored.duration_s, stored.width, stored.height, stored.codec) == (
        12.5,
        1920,
        1080,
        "h264",
    )


def test_done_before_started_is_applied_and_the_late_started_changes_nothing(
    client: TestClient, session: Session
) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="queued")
    worker_event(client, analysis.id, **done())
    worker_event(client, analysis.id, type="started")
    assert state(client, video.id)["state"] == "done"


def test_failed_after_done_changes_nothing(client: TestClient, session: Session) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    worker_event(client, analysis.id, **done())
    worker_event(client, analysis.id, type="failed", reason="late")
    assert state(client, video.id)["state"] == "done"


def test_started_counts_attempts_and_a_failure_keeps_its_reason(
    client: TestClient, session: Session
) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="queued")
    analysis_row = session.get(Analysis, analysis.id)
    assert analysis_row is not None
    analysis_row.attempts = 0
    session.commit()
    worker_event(client, analysis.id, type="started")
    worker_event(client, analysis.id, type="started")  # a worker crashed; Pub/Sub redelivered
    worker_event(client, analysis.id, type="failed", reason="Not a valid MP4.")
    analysis_state = state(client, video.id)
    assert (analysis_state["state"], analysis_state["error"], analysis_state["attempts"]) == (
        "failed",
        "Not a valid MP4.",
        2,
    )


def test_progress_never_moves_backwards(client: TestClient, session: Session) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    worker_event(client, analysis.id, type="progress", progress=0.6)
    worker_event(client, analysis.id, type="progress", progress=0.3)  # arrived out of order
    assert state(client, video.id)["progress"] == pytest.approx(0.6)


def test_a_malformed_worker_event_is_acknowledged_and_ignored(
    client: TestClient, session: Session
) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    assert worker_event(client, analysis.id, type="exploded").status_code == 204
    assert push(client, "/internal/analysis-events", b"\x00garbage").status_code == 204
    assert state(client, video.id)["state"] == "processing"


def test_a_worker_event_marks_only_a_changed_video_dirty(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    video, analysis = add_uploaded_video(session, analysis_status="processing")
    marked: list[uuid.UUID] = []
    monkeypatch.setattr(streams, "mark_dirty", marked.append)
    worker_event(client, analysis.id, **done())
    worker_event(client, analysis.id, **done())  # changes nothing: no wake-up
    assert marked == [video.id]
