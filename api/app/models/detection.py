import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Index, SmallInteger
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.analysis import Analysis


class DetectionBase(SQLModel):
    """Fields the table shares with the API's DetectionPublic (app/schemas.py)."""

    t_seconds: float  # seconds into the video
    confidence: float
    x1: float  # box corners, normalized to the picture (0-1)
    y1: float
    x2: float
    y2: float


class Detection(DetectionBase, table=True):
    __tablename__ = "detections"
    __table_args__ = (
        CheckConstraint("sample_idx >= 0", name="sample_idx"),
        CheckConstraint("t_seconds >= 0", name="t_seconds"),
        CheckConstraint("confidence > 0 AND confidence <= 1", name="confidence"),
        CheckConstraint(
            "0 <= x1 AND x1 < x2 AND x2 <= 1 AND 0 <= y1 AND y1 < y2 AND y2 <= 1", name="box"
        ),
        Index("ix_detections_video_t", "video_id", "t_seconds"),
    )

    analysis_id: uuid.UUID = Field(foreign_key="analyses.id", primary_key=True, ondelete="CASCADE")
    sample_idx: int = Field(primary_key=True)
    det_rank: int = Field(primary_key=True, sa_type=SmallInteger)
    video_id: uuid.UUID = Field(foreign_key="videos.id")
    class_id: int = Field(default=52, sa_type=SmallInteger)

    analysis: "Analysis" = Relationship(back_populates="detections")
