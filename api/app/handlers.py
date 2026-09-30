"""Pub/Sub message handlers (D2, D3, D3a). The push routes in api/routes/internal.py call them;
locally, the emulator's pull loop will call the same functions (step 6).

D2's ack rule: a handler returns only once its effect is durable. Raising makes the push fail,
so Pub/Sub delivers the message again; every handler is therefore safe to run twice.
"""

import logging

from sqlmodel import Session

from app import crud
from app.core.streams import streams
from app.gcp.pubsub import Publisher
from app.gcp.storage import Storage
from app.messages import (
    AnalysisEvent,
    DoneEvent,
    FailedEvent,
    GcsObject,
    Job,
    ProgressEvent,
    StartedEvent,
)

log = logging.getLogger(__name__)


def handle_upload(
    session: Session, storage: Storage, publisher: Publisher, landed: GcsObject
) -> None:
    """An upload landed: mark the video uploaded, queue its analysis and publish the job."""
    video = crud.get_video_by_object(session, landed.name)
    if video is None:
        log.info("Ignoring an object that matches no video: %s", landed.name)
        return  # e.g. a manual upload to the bucket: acknowledge, or it is retried for days
    if video.status == "rejected":
        storage.delete(video.object_name)  # a redelivery retries a deletion that failed
        return
    if video.status == "awaiting_upload" and (problem := crud.upload_problem(video, landed)):
        crud.reject_upload(session, video, problem)
        streams.mark_dirty(video.id)
        storage.delete(video.object_name)
        return
    analysis = crud.record_upload(session, video, landed)
    streams.mark_dirty(video.id)
    # Publish while queued, including on a redelivery whose first publish may have succeeded:
    # the handler cannot tell, and a duplicate job is harmless (D3a). Once the job has started,
    # a redelivered upload event publishes nothing.
    if analysis.status == "queued":
        publisher.publish_job(Job(analysis_id=analysis.id, video_id=video.id))


def handle_analysis_event(session: Session, event: AnalysisEvent) -> None:
    """Apply one of the worker's events. A stale or duplicate event changes nothing."""
    match event:
        case StartedEvent():
            changed = crud.start_analysis(session, event.analysis_id)
        case ProgressEvent():
            changed = crud.record_progress(session, event.analysis_id, event.progress)
        case DoneEvent():
            changed = crud.finish_analysis(session, event)
        case FailedEvent():
            changed = crud.fail_analysis(session, event.analysis_id, event.reason)
    if changed is not None:
        streams.mark_dirty(changed)
