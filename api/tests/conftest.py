import os
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlmodel import Session, create_engine
from testcontainers.community.postgres import PostgresContainer

from app.api.deps import get_publisher, get_session, get_storage
from app.gcp.storage import SignedUpload
from app.main import app
from app.messages import Job


class FakeStorage:
    """Signs nothing: returns recognisable URLs, so tests need no GCS."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    def upload_target(self, object_name: str, size: int) -> SignedUpload:
        headers = {"Content-Type": "video/mp4", "x-goog-content-length-range": f"{size},{size}"}
        return SignedUpload(url=f"https://gcs.test/put/{object_name}", headers=headers)

    def playback_url(self, object_name: str) -> str:
        return f"https://gcs.test/get/{object_name}"

    def delete(self, object_name: str) -> None:
        self.deleted.append(object_name)


class FakePublisher:
    """Records published jobs instead of sending them to Pub/Sub."""

    def __init__(self) -> None:
        self.jobs: list[Job] = []

    def publish_job(self, job: Job) -> None:
        self.jobs.append(job)


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A throwaway postgres:17 with the migrations applied, shared by the whole test run.
    Without Docker, HOTDOG_TEST_DATABASE_URL names an empty database to use instead: the tests
    migrate it, empty its tables and downgrade it, so it must be one kept for them."""
    if url := os.environ.get("HOTDOG_TEST_DATABASE_URL"):
        yield migrated(url)
        return
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        yield migrated(postgres.get_connection_url())


def migrated(url: str) -> str:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")
    return url


@pytest.fixture(scope="session")
def engine(database_url: str) -> Iterator[Engine]:
    engine = create_engine(database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    """A session on the test database; every table is emptied after the test."""
    with Session(engine) as session:
        yield session
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE videos, analyses, detections CASCADE"))


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def publisher() -> FakePublisher:
    return FakePublisher()


@pytest.fixture
def client(
    engine: Engine, session: Session, storage: FakeStorage, publisher: FakePublisher
) -> Iterator[TestClient]:
    """The app on the test database, with GCS and Pub/Sub replaced by fakes."""

    def request_session() -> Iterator[Session]:
        """A session per request, as in production; the test keeps its own."""
        with Session(engine) as request_session:
            yield request_session

    app.dependency_overrides[get_session] = request_session
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_publisher] = lambda: publisher
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
