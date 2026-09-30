"""FastAPI dependencies: the database session and the GCP clients, one place to wire them.
Tests replace them through app.dependency_overrides."""

from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session

from app.core.config import Settings, get_settings
from app.core.db import get_engine
from app.gcp.pubsub import Publisher, PubSubPublisher
from app.gcp.storage import GcsStorage, Storage


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


@lru_cache
def get_storage() -> Storage:
    return GcsStorage(get_settings().bucket)


@lru_cache
def get_publisher() -> Publisher:
    settings = get_settings()
    return PubSubPublisher(settings.project_id, settings.jobs_topic)


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[Session, Depends(get_session)]
StorageDep = Annotated[Storage, Depends(get_storage)]
PublisherDep = Annotated[Publisher, Depends(get_publisher)]
