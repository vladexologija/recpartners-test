"""FastAPI dependencies: the GCP clients and the detector, one place to wire them.
Tests replace them through app.dependency_overrides."""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from app.core.config import get_settings
from app.gcp.pubsub import EventPublisher, PubSubEventPublisher
from app.gcp.storage import GcsStorage, Storage
from app.pipeline.detector import Detector, YoloDetector


@lru_cache
def get_storage() -> Storage:
    settings = get_settings()
    return GcsStorage(settings.project_id, settings.bucket)


@lru_cache
def get_publisher() -> EventPublisher:
    settings = get_settings()
    return PubSubEventPublisher(settings.project_id, settings.events_topic)


@lru_cache
def get_detector() -> Detector:
    """Loaded once per container, at startup (app/main.py), not inside a job (D3a)."""
    settings = get_settings()
    return YoloDetector(settings.model_path, settings.torch_threads)


StorageDep = Annotated[Storage, Depends(get_storage)]
PublisherDep = Annotated[EventPublisher, Depends(get_publisher)]
DetectorDep = Annotated[Detector, Depends(get_detector)]
