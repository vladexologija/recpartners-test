"""The worker's settings, and the detection pipeline's fixed parameters."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The pipeline's parameters, fixed in code. The API labels results with a PIPELINE_VERSION that
# describes exactly these values ('yolo26n-pt|640|fps2|c0.25', api/app/core/config.py).
SAMPLE_FPS = 2
MODEL_IMAGE_SIZE = 640  # frames are scaled so their long side matches the model's input
HOT_DOG_CLASS = 52  # COCO's "hot dog"
MIN_CONFIDENCE = 0.25  # stored from here; the UI shows boxes from 0.40 (the API's threshold)
MAX_BOXES_PER_FRAME = 10  # keeps a `done` event far below Pub/Sub's 10 MB limit (D3)
PREDICT_BATCH = 8  # frames per model call
MAX_DURATION_S = 15 * 60


class Settings(BaseSettings):
    """Read from HOTDOG_* environment variables; locally also from worker/.env."""

    model_config = SettingsConfigDict(env_prefix="HOTDOG_", env_file=".env")

    project_id: str = Field(min_length=1)  # holds the analysis-events topic
    bucket: str = Field(min_length=1)  # uploads are gs://<bucket>/videos/<video_id>.mp4
    events_topic: str = "analysis-events"
    model_path: str = "models/yolo26n.pt"
    # The instance's vCPUs, set by Terraform (D4). Unset keeps ultralytics' own choice.
    torch_threads: int | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # fields come from the environment
