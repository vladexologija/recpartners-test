import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from sqlalchemy import CheckConstraint, DateTime, SmallInteger, UniqueConstraint
from sqlmodel import AutoString, Field, Relationship, SQLModel

from app.models.common import utc_now

if TYPE_CHECKING:
    from app.models.detection import Detection
    from app.models.video import Video

AnalysisStatus = Literal["queued", "processing", "done", "failed"]


class AnalysisBase(SQLModel):
    """Fields the table shares with the API's AnalysisPublic (app/schemas.py)."""

    progress: float | None = None  # 0-1 while processing, 1 when done
    error: str | None = None  # why it failed, e.g. "not a valid MP4"
    attempts: int = Field(default=0, sa_type=SmallInteger)  # >1 means a worker crashed
    frames_sampled: int | None = None
    detection_count: int | None = None


class Analysis(AnalysisBase, table=True):
    __tablename__ = "analyses"
    __table_args__ = (
        UniqueConstraint("video_id", "pipeline_version", name="one_result_set"),
        CheckConstraint("status IN ('queued', 'processing', 'done', 'failed')", name="status"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    video_id: uuid.UUID = Field(foreign_key="videos.id")
    pipeline_version: str  # e.g. 'yolo26n-pt|640|fps2|c0.25'
    sample_fps: Decimal = Field(max_digits=4, decimal_places=2)
    status: AnalysisStatus = Field(default="queued", sa_type=AutoString)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    started_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    finished_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    video: "Video" = Relationship(back_populates="analyses")
    detections: list["Detection"] = Relationship(back_populates="analysis", cascade_delete=True)
