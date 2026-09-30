from datetime import timedelta
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The detection pipeline's parameters. Fixed in code, not settings: the worker runs with the
# same values, and PIPELINE_VERSION is part of the analyses' unique key (D3a, D4).
PIPELINE_VERSION = "yolo26n-pt|640|fps2|c0.25"
SAMPLE_FPS = 2
DISPLAY_THRESHOLD = 0.40  # detections are stored from 0.25; the UI shows them from 0.40

MAX_UPLOAD_BYTES = 209_715_200  # 200 MB (D9)
# New videos accepted per window from everyone together: the public demo's cost brake (Part 1 §4).
UPLOAD_LIMITS = ((timedelta(hours=1), 30), (timedelta(days=1), 200))


class Settings(BaseSettings):
    """Read from HOTDOG_* environment variables; locally also from api/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_prefix="HOTDOG_", env_file=".env")

    database_url: str  # postgresql+psycopg://user:password@host:port/database
    # min_length: an empty value fails at startup, naming the setting, not deep inside GCP code
    project_id: str = Field(min_length=1)  # the GCP project that holds the Pub/Sub topics
    bucket: str = Field(min_length=1)  # uploads land in gs://<bucket>/videos/<id>.mp4
    jobs_topic: str = "analysis-jobs"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # fields come from the environment
