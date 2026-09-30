"""The video's event stream (D7)."""

import asyncio
import json
import threading
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import Engine
from sqlmodel import Session, col, update

from app.api.routes import videos
from app.core.streams import Streams, streams
from app.models import Analysis
from tests.test_videos import add_uploaded_video


def video_events(response: Response) -> Iterator[dict[str, object]]:
    """The videos sent, in order; `: ping` comments are skipped."""
    for line in response.iter_lines():
        if line.startswith("data: "):
            yield json.loads(line.removeprefix("data: "))


def test_a_finished_video_is_sent_once_then_the_stream_ends(
    client: TestClient, session: Session
) -> None:
    video, _ = add_uploaded_video(session, analysis_status="done")
    with client.stream("GET", f"/api/videos/{video.id}/events") as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        sent = list(video_events(response))
    assert [event["analysis"]["state"] for event in sent] == ["done"]  # type: ignore[index]
    assert streams.count(video.id) == 0


def test_every_change_is_sent_until_the_analysis_finishes(
    client: TestClient, session: Session, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(videos, "STREAM_LIMIT_S", 5.0)  # a lost change fails in 5 s, not 60
    video, analysis = add_uploaded_video(session, analysis_status="processing")

    def finish() -> None:
        """Another request's change: commit, then mark dirty, from a thread of its own."""
        with Session(engine) as other:
            other.exec(
                update(Analysis).where(col(Analysis.id) == analysis.id).values(status="done")
            )
            other.commit()
        streams.mark_dirty(video.id)

    # TestClient returns the body only once the stream ends, so the change must come while the
    # request is still running: from a timer.
    timer = threading.Timer(0.3, finish)
    timer.start()
    with client.stream("GET", f"/api/videos/{video.id}/events") as response:
        sent = list(video_events(response))
    timer.join()
    assert [event["analysis"]["state"] for event in sent] == ["processing", "done"]  # type: ignore[index]


def test_a_reprocess_marks_the_video_dirty(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    video, _ = add_uploaded_video(session, analysis_status="done")
    marked: list[uuid.UUID] = []
    monkeypatch.setattr(streams, "mark_dirty", marked.append)
    client.post(f"/api/videos/{video.id}/reprocess")
    assert marked == [video.id]


def test_an_unfinished_stream_ends_after_the_time_limit(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(videos, "STREAM_LIMIT_S", 0.2)
    video, _ = add_uploaded_video(session, analysis_status="queued")
    with client.stream("GET", f"/api/videos/{video.id}/events") as response:
        sent = list(video_events(response))
    assert [event["analysis"]["state"] for event in sent] == ["queued"]  # type: ignore[index]


def test_an_unknown_video_is_404(client: TestClient) -> None:
    assert client.get(f"/api/videos/{uuid.uuid4()}/events").status_code == 404


@pytest.mark.anyio
async def test_a_change_after_registering_is_not_lost() -> None:
    """D7's ordering rule: a stream registers before its first read, so a change committed in
    between (here: from another thread) still wakes it."""
    registry, video_id = Streams(), uuid.uuid4()
    with registry.follow(video_id) as dirty:
        await asyncio.to_thread(registry.mark_dirty, video_id)
        await asyncio.wait_for(dirty.wait(), timeout=1)
    assert registry.count(video_id) == 0


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
