"""Pub/Sub messages (D3, D11): the worker's copy of the contract with the API. The API defines
its own models; both sides' tests check them against the examples in contracts/."""

import base64
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter


class Job(BaseModel):
    """Received from `analysis-jobs`: process videos/<video_id>.mp4 for this analysis."""

    analysis_id: uuid.UUID
    video_id: uuid.UUID


class StartedEvent(BaseModel):
    analysis_id: uuid.UUID
    type: Literal["started"] = "started"


class ProgressEvent(BaseModel):
    analysis_id: uuid.UUID
    type: Literal["progress"] = "progress"
    progress: float = Field(ge=0, le=1)


class DetectedBox(BaseModel):
    sample_idx: int = Field(ge=0)  # the sampled frame, counted from 0
    det_rank: int = Field(ge=0)  # the box's rank within its frame, by confidence
    t_seconds: float = Field(ge=0)
    confidence: float = Field(gt=0, le=1)
    x1: float  # box corners, normalized to the picture (0-1)
    y1: float
    x2: float
    y2: float


class DoneEvent(BaseModel):
    """The worker has no database, so its ffprobe results travel with the detections."""

    analysis_id: uuid.UUID
    type: Literal["done"] = "done"
    frames_sampled: int = Field(ge=0)
    duration_s: float
    width: int
    height: int
    codec: str
    detections: list[DetectedBox]


class FailedEvent(BaseModel):
    analysis_id: uuid.UUID
    type: Literal["failed"] = "failed"
    reason: str  # shown to the user, e.g. "Not a valid MP4."


AnalysisEvent = Annotated[
    StartedEvent | ProgressEvent | DoneEvent | FailedEvent, Field(discriminator="type")
]
analysis_event = TypeAdapter[AnalysisEvent](AnalysisEvent)


class PushMessage(BaseModel):
    data: str = ""  # base64
    attributes: dict[str, str] = {}

    def decoded(self) -> bytes:
        return base64.b64decode(self.data)


class PushEnvelope(BaseModel):
    """What a Pub/Sub push subscription POSTs."""

    message: PushMessage
