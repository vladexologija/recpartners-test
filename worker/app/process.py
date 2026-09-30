"""One job, as D3a describes it: started → download → ffprobe → sample and detect → done.
Every error ends as a `failed` event with a reason for the user; the user's Reprocess is the
retry. The worker keeps nothing between jobs."""

import itertools
import logging
import math
import tempfile
from collections.abc import Callable
from contextlib import closing
from functools import partial
from pathlib import Path

from app.core.config import MODEL_IMAGE_SIZE, PREDICT_BATCH, SAMPLE_FPS
from app.gcp.pubsub import EventPublisher
from app.gcp.storage import Storage
from app.messages import (
    DetectedBox,
    DoneEvent,
    FailedEvent,
    Job,
    ProgressEvent,
    StartedEvent,
)
from app.pipeline.detector import Box, Detector
from app.pipeline.frames import Frame, sample_frames
from app.pipeline.probe import NotProcessable, VideoInfo, frame_size, probe

log = logging.getLogger(__name__)


def process_job(
    job: Job,
    storage: Storage,
    publisher: EventPublisher,
    detector: Detector,
) -> None:
    """Returns once the job's final event is durable (D2). Raises only if even that event
    cannot be published: the push then fails, and Pub/Sub delivers the job again."""
    publisher.publish(StartedEvent(analysis_id=job.analysis_id))
    final_event: DoneEvent | FailedEvent
    try:
        final_event = analyse(job, storage, publisher, detector)
    except NotProcessable as problem:
        final_event = FailedEvent(analysis_id=job.analysis_id, reason=str(problem))
    except Exception:
        log.exception("Analysis %s failed", job.analysis_id)
        final_event = FailedEvent(
            analysis_id=job.analysis_id, reason="Processing failed unexpectedly."
        )
    publisher.publish(final_event)


def analyse(
    job: Job,
    storage: Storage,
    publisher: EventPublisher,
    detector: Detector,
) -> DoneEvent:
    """Download the video, probe it, and run the detector on its sampled frames."""
    # /tmp is in memory on Cloud Run!!
    with tempfile.TemporaryDirectory(prefix="hotdog-") as workdir:
        video = Path(workdir) / "video.mp4"
        storage.download(f"videos/{job.video_id}.mp4", video)
        info = probe(video)
        report_progress = partial(_report_progress, publisher, job)
        frames_sampled, detections = _detect(video, info, detector, report_progress)
    return DoneEvent(
        analysis_id=job.analysis_id,
        frames_sampled=frames_sampled,
        duration_s=info.duration_s,
        width=info.width,
        height=info.height,
        codec=info.codec,
        detections=detections,
    )


def _detect(
    video: Path,
    info: VideoInfo,
    detector: Detector,
    report_progress: Callable[[float], None],
) -> tuple[int, list[DetectedBox]]:
    """Run the detector on frames sampled at SAMPLE_FPS, a batch at a time, and report
    progress after each batch. Returns the number of frames sampled and their boxes."""
    expected_frames = max(1, math.ceil(info.duration_s * SAMPLE_FPS))
    frames_sampled = 0
    detections: list[DetectedBox] = []
    frames = sample_frames(video, frame_size(info, MODEL_IMAGE_SIZE), SAMPLE_FPS)
    with closing(frames):  # stops ffmpeg even if detection raises
        for batch in itertools.batched(frames, PREDICT_BATCH):
            found = detector.detect([frame.pixels for frame in batch])
            for frame, boxes in zip(batch, found, strict=True):
                detections.extend(_detected_boxes(frame, boxes))
            frames_sampled += len(batch)
            report_progress(frames_sampled / expected_frames)
    return frames_sampled, detections


def _detected_boxes(frame: Frame, boxes: list[Box]) -> list[DetectedBox]:
    """A frame's boxes as the `done` event carries them. The detector lists them most
    confident first, so a box's position is its rank."""
    return [
        DetectedBox(
            sample_idx=frame.sample_idx,
            det_rank=rank,
            t_seconds=frame.t_seconds,
            confidence=box.confidence,
            x1=box.x1,
            y1=box.y1,
            x2=box.x2,
            y2=box.y2,
        )
        for rank, box in enumerate(boxes)
    ]


def _report_progress(publisher: EventPublisher, job: Job, progress: float) -> None:
    """Sent after every batch (D3); capped at 0.99, as 1 is `done`'s to report.
    Best effort: a progress event that fails to publish is logged and skipped (D3a)."""
    event = ProgressEvent(analysis_id=job.analysis_id, progress=min(progress, 0.99))
    try:
        publisher.publish(event)
    except Exception:
        log.warning("Skipping a progress event for %s", job.analysis_id, exc_info=True)
