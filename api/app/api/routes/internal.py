"""Pub/Sub push endpoints (D3). Not part of the public API: hidden from the OpenAPI schema."""

import logging

from fastapi import APIRouter, status

from app import handlers
from app.api.deps import PublisherDep, SessionDep, StorageDep
from app.messages import GcsObject, PushEnvelope, analysis_event

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", include_in_schema=False)


@router.post("/gcs-events", status_code=status.HTTP_204_NO_CONTENT)
def gcs_event(
    envelope: PushEnvelope, session: SessionDep, storage: StorageDep, publisher: PublisherDep
) -> None:
    """The bucket's OBJECT_FINALIZE notification, through the `uploads` topic."""
    if envelope.message.attributes.get("eventType") != "OBJECT_FINALIZE":
        return
    try:
        landed = GcsObject.model_validate_json(envelope.message.decoded())
    except ValueError:
        log.warning("Ignoring a malformed upload event: %s", envelope.message.data[:200])
        return  # acknowledged: a malformed message would otherwise be retried for days (D2)
    handlers.handle_upload(session, storage, publisher, landed)


@router.post("/analysis-events", status_code=status.HTTP_204_NO_CONTENT)
def worker_event(envelope: PushEnvelope, session: SessionDep) -> None:
    """The worker's started, progress, done and failed events, through `analysis-events`."""
    try:
        event = analysis_event.validate_json(envelope.message.decoded())
    except ValueError:
        log.warning("Ignoring a malformed worker event: %s", envelope.message.data[:200])
        return
    handlers.handle_analysis_event(session, event)
