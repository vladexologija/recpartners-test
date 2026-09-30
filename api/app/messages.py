"""Pub/Sub messages (D3, D11). The job and the worker's events are the contract with the worker:
it defines its own copy of these models, and both sides' tests check them against the examples
in contracts/. The push envelope and the GCS object come from Google."""

import base64
import uuid
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter
from sqlmodel import SQLModel

# --- The contract with the worker ---------------------------------------------------------


class Job(SQLModel):
    """Published to `analysis-jobs`: the worker processes videos/<video_id>.mp4."""

    analysis_id: uuid.UUID
    video_id: uuid.UUID


class StartedEvent(SQLModel):
    analysis_id: uuid.UUID
    type: Literal["started"]


class ProgressEvent(SQLModel):
    analysis_id: uuid.UUID
    type: Literal["progress"]
    progress: float = Field(ge=0, le=1)


class DetectedBox(SQLModel):
    sample_idx: int = Field(ge=0)  # the sampled frame, counted from 0
    det_rank: int = Field(ge=0)  # the box's rank within its frame
    t_seconds: float = Field(ge=0)
    confidence: float = Field(gt=0, le=1)
    x1: float  # box corners, normalized to the picture (0-1)
    y1: float
    x2: float
    y2: float


class DoneEvent(SQLModel):
    """The worker has no database, so its ffprobe results travel with the detections."""

    analysis_id: uuid.UUID
    type: Literal["done"]
    frames_sampled: int = Field(ge=0)
    duration_s: float
    width: int
    height: int
    codec: str
    detections: list[DetectedBox]


class FailedEvent(SQLModel):
    analysis_id: uuid.UUID
    type: Literal["failed"]
    reason: str  # shown to the user, e.g. "not a valid MP4"


AnalysisEvent = Annotated[
    StartedEvent | ProgressEvent | DoneEvent | FailedEvent, Field(discriminator="type")
]
analysis_event = TypeAdapter[AnalysisEvent](AnalysisEvent)

# --- From Google --------------------------------------------------------------------------


class PushMessage(SQLModel):
    data: str = ""  # base64
    attributes: dict[str, str] = {}

    def decoded(self) -> bytes:
        return base64.b64decode(self.data)


class PushEnvelope(SQLModel):
    """What a Pub/Sub push subscription POSTs."""

    message: PushMessage


class GcsObject(SQLModel):
    """The object resource in a bucket notification (payload format JSON_API_V1)."""

    name: str
    size: int  # GCS sends these two as strings; validation converts them
    generation: int
