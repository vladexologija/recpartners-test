"""Database tables, one module per table. Importing this package registers all of them on
SQLModel.metadata, which Alembic autogenerates migrations from (migrations/env.py)."""

from app.models.analysis import Analysis, AnalysisBase, AnalysisStatus
from app.models.detection import Detection, DetectionBase
from app.models.video import Video, VideoBase, VideoStatus

__all__ = [
    "Analysis",
    "AnalysisBase",
    "AnalysisStatus",
    "Detection",
    "DetectionBase",
    "Video",
    "VideoBase",
    "VideoStatus",
]
