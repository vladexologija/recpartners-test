"""The job endpoint (D3, D3a): the `analysis-jobs` push subscription delivers here. The worker
service is private: Cloud Run checks the push's OIDC token before a request reaches the code."""

import logging

from fastapi import APIRouter, status

from app.api.deps import DetectorDep, PublisherDep, StorageDep
from app.messages import Job, PushEnvelope
from app.process import process_job

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", include_in_schema=False)


@router.post("/process", status_code=status.HTTP_204_NO_CONTENT)
def process(
    envelope: PushEnvelope,
    storage: StorageDep,
    publisher: PublisherDep,
    detector: DetectorDep,
) -> None:
    """The response is the acknowledgement: 2xx only once the final event is durable (D2).
    Cloud Run runs one job per instance (concurrency 1)."""
    try:
        job = Job.model_validate_json(envelope.message.decoded())
    except ValueError:
        log.warning("Ignoring a malformed job: %s", envelope.message.data[:200])
        return  # no analysis to report a failure to: acknowledge, or it is retried for days
    process_job(job, storage, publisher, detector)
