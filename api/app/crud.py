"""Every database read and write. The analysis state changes are each guarded by the current
status in the SQL itself, so a race or a redelivered event cannot corrupt the state (D3a)."""

import uuid
from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import Update
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, and_, col, delete, func, select, update

from app.core.config import MAX_UPLOAD_BYTES, PIPELINE_VERSION, SAMPLE_FPS, UPLOAD_LIMITS
from app.messages import DoneEvent, GcsObject
from app.models import Analysis, Detection, Video
from app.models.common import utc_now
from app.schemas import VideoCreate


def object_name(video_id: uuid.UUID) -> str:
    return f"videos/{video_id}.mp4"


# --- Videos -------------------------------------------------------------------------------


def create_video(session: Session, body: VideoCreate) -> Video:
    """Insert the video unless its id exists, and return the stored row. The browser generates
    the id, so a retried request finds its own earlier row (the caller compares the details)."""
    new = Video(
        id=body.id,
        original_filename=body.original_filename,
        declared_size=body.declared_size,
        object_name=object_name(body.id),
    )
    # model_dump() carries the Python-side defaults (status, created_at) into the statement.
    session.exec(
        insert(Video).values(new.model_dump()).on_conflict_do_nothing(index_elements=["id"])
    )
    session.commit()
    video = session.get(Video, body.id)
    assert video is not None
    return video


def upload_limit_reached(session: Session) -> bool:
    """True when the last hour or the last day already holds its share of new videos."""
    now = utc_now()
    return any(
        (session.scalar(select(func.count()).where(col(Video.created_at) >= now - window)) or 0)
        >= limit
        for window, limit in UPLOAD_LIMITS
    )


def get_video_by_object(session: Session, object_name: str) -> Video | None:
    return session.exec(select(Video).where(Video.object_name == object_name)).first()


def upload_problem(video: Video, landed: GcsObject) -> str | None:
    """D9, layer 3: the signed PUT pins the size, so a mismatch means someone bypassed it."""
    if landed.size > MAX_UPLOAD_BYTES:
        return "The file is larger than 200 MB."
    if landed.size != video.declared_size:
        return "The uploaded file does not match the declared size."
    return None


def record_upload(session: Session, video: Video, landed: GcsObject) -> Analysis:
    """The upload landed: mark the video uploaded and queue its analysis, in one transaction.
    Both writes are no-ops on a redelivery, which returns the existing analysis."""
    session.exec(
        update(Video)
        .where(col(Video.id) == video.id, col(Video.status) == "awaiting_upload")
        .values(
            status="uploaded",
            size_bytes=landed.size,
            gcs_generation=landed.generation,
            uploaded_at=func.now(),
        )
    )
    new = Analysis(
        video_id=video.id, pipeline_version=PIPELINE_VERSION, sample_fps=Decimal(SAMPLE_FPS)
    )
    session.exec(
        insert(Analysis)
        .values(new.model_dump())
        .on_conflict_do_nothing(index_elements=["video_id", "pipeline_version"])
    )
    session.commit()
    found = load_video(session, video.id)
    assert found is not None and found[1] is not None
    return found[1]


def reject_upload(session: Session, video: Video, reason: str) -> bool:
    """Final: the video will never be processed. Returns whether this call rejected it."""
    result = session.exec(
        update(Video)
        .where(col(Video.id) == video.id, col(Video.status) == "awaiting_upload")
        .values(status="rejected", error=reason)
    )
    session.commit()
    return result.rowcount > 0


def load_video(session: Session, video_id: uuid.UUID) -> tuple[Video, Analysis | None] | None:
    """The video and its analysis for the current pipeline (None until the upload landed),
    in one query: the LEFT JOIN yields the video with a NULL analysis before the upload."""
    row = session.exec(
        select(Video, Analysis)
        .outerjoin(
            Analysis,
            and_(
                col(Analysis.video_id) == Video.id,
                col(Analysis.pipeline_version) == PIPELINE_VERSION,
            ),
        )
        .where(Video.id == video_id)
    ).first()
    if row is None:
        return None
    video, analysis = row
    return video, analysis


def list_detections(session: Session, analysis_id: uuid.UUID) -> Sequence[Detection]:
    return session.exec(
        select(Detection)
        .where(Detection.analysis_id == analysis_id)
        .order_by(col(Detection.t_seconds), col(Detection.det_rank))
    ).all()


# --- Analysis state changes (D3a) ---------------------------------------------------------


def restart_analysis(session: Session, analysis_id: uuid.UUID) -> bool:
    """Reprocess: delete the results and start over (D3a).

    Refused while the job is being processed (returns False): it has to finish first. Allowed
    while queued, so a Reprocess after a failed publish simply publishes again.
    """
    result = session.exec(
        update(Analysis)
        .where(col(Analysis.id) == analysis_id, col(Analysis.status) != "processing")
        .values(
            status="queued",
            attempts=0,
            progress=None,
            error=None,
            frames_sampled=None,
            detection_count=None,
            started_at=None,
            finished_at=None,
        )
    )
    if result.rowcount == 0:
        session.rollback()
        return False
    session.exec(delete(Detection).where(col(Detection.analysis_id) == analysis_id))
    session.commit()
    return True


# The worker's events. Pub/Sub may deliver them twice, late or out of order: each write is
# guarded by the analysis's status, so a stale event changes nothing. Each returns the video's
# id when it changed something (the caller then marks the video's streams dirty), else None.


def start_analysis(session: Session, analysis_id: uuid.UUID) -> uuid.UUID | None:
    """`done` may overtake `started`, so a late `started` must not reopen a finished job."""
    return _guarded(
        session,
        update(Analysis)
        .where(col(Analysis.id) == analysis_id, col(Analysis.status).in_(("queued", "processing")))
        .values(status="processing", attempts=col(Analysis.attempts) + 1, started_at=func.now()),
    )


def record_progress(session: Session, analysis_id: uuid.UUID, progress: float) -> uuid.UUID | None:
    """Progress never moves backwards, whatever order the events arrive in."""
    return _guarded(
        session,
        update(Analysis)
        .where(col(Analysis.id) == analysis_id, col(Analysis.status) == "processing")
        .values(progress=func.greatest(func.coalesce(col(Analysis.progress), 0), progress)),
    )


def finish_analysis(session: Session, event: DoneEvent) -> uuid.UUID | None:
    """Replace the results in one transaction, under a row lock: a duplicate `done` finds the
    analysis already finished and changes nothing, so there is only ever one result set."""
    analysis = session.exec(
        select(Analysis)
        .where(
            col(Analysis.id) == event.analysis_id,
            col(Analysis.status).in_(("queued", "processing")),
        )
        .with_for_update()
    ).first()
    if analysis is None:
        session.rollback()
        return None
    session.exec(delete(Detection).where(col(Detection.analysis_id) == analysis.id))
    session.add_all(
        Detection(analysis_id=analysis.id, video_id=analysis.video_id, **box.model_dump())
        for box in event.detections
    )
    analysis.status = "done"
    analysis.progress = 1
    analysis.error = None
    analysis.frames_sampled = event.frames_sampled
    analysis.detection_count = len(event.detections)
    analysis.finished_at = utc_now()
    session.exec(
        update(Video)
        .where(col(Video.id) == analysis.video_id)
        .values(
            duration_s=event.duration_s,
            width=event.width,
            height=event.height,
            codec=event.codec,
        )
    )
    video_id = analysis.video_id
    session.commit()
    return video_id


def fail_analysis(session: Session, analysis_id: uuid.UUID, reason: str) -> uuid.UUID | None:
    return _guarded(
        session,
        update(Analysis)
        .where(col(Analysis.id) == analysis_id, col(Analysis.status).in_(("queued", "processing")))
        .values(status="failed", error=reason, finished_at=func.now()),
    )


def _guarded(session: Session, statement: Update) -> uuid.UUID | None:
    video_id = session.exec(statement.returning(col(Analysis.video_id))).scalar_one_or_none()
    session.commit()
    return video_id
