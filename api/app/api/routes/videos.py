import asyncio
import uuid
from collections.abc import AsyncIterable
from typing import Annotated

from asyncer import asyncify
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.sse import EventSourceResponse
from sqlmodel import Session

from app import crud
from app.api.deps import PublisherDep, SessionDep, StorageDep
from app.core.config import DISPLAY_THRESHOLD
from app.core.streams import streams
from app.messages import Job
from app.models import Analysis, Video
from app.schemas import (
    DetectionPublic,
    DetectionsPublic,
    PlaybackPublic,
    UploadTarget,
    VideoCreate,
    VideoCreated,
    VideoPublic,
)

router = APIRouter(prefix="/videos", tags=["videos"])

STREAM_LIMIT_S = 60.0  # then the browser reconnects, landing on the current instance (D7)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_video(body: VideoCreate, session: SessionDep, storage: StorageDep) -> VideoCreated:
    """Register a video and sign its upload. Idempotent: the browser generates the id, so a
    retried request returns the same upload instead of creating a second video. New videos are
    capped per hour and per day (UPLOAD_LIMITS); a retry is never refused."""
    if session.get(Video, body.id) is None and crud.upload_limit_reached(session):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many uploads right now: try again later"
        )
    video = crud.create_video(session, body)
    if (video.original_filename, video.declared_size) != (
        body.original_filename,
        body.declared_size,
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Another video already uses this id")
    if video.status != "awaiting_upload":
        raise HTTPException(status.HTTP_409_CONFLICT, "This video has already been uploaded")
    signed = storage.upload_target(video.object_name, video.declared_size)
    return VideoCreated(
        id=video.id, upload=UploadTarget(method="PUT", url=signed.url, headers=signed.headers)
    )


@router.get("/{video_id}")
def read_video(video_id: uuid.UUID, session: SessionDep) -> VideoPublic:
    video, analysis = load_or_404(session, video_id)
    return VideoPublic.from_db(video, analysis)


@router.get("/{video_id}/playback")
def read_playback(video_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> PlaybackPublic:
    video, _ = load_or_404(session, video_id)
    if video.status != "uploaded":
        raise HTTPException(status.HTTP_409_CONFLICT, "The video has not been uploaded")
    return PlaybackPublic(url=storage.playback_url(video.object_name))


@router.get("/{video_id}/detections")
def read_detections(video_id: uuid.UUID, session: SessionDep) -> DetectionsPublic:
    _, analysis = load_or_404(session, video_id)
    if analysis is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The video has not been uploaded")
    return DetectionsPublic(
        sample_fps=float(analysis.sample_fps),
        display_threshold=DISPLAY_THRESHOLD,
        detections=[
            DetectionPublic.model_validate(row)
            for row in crud.list_detections(session, analysis.id)
        ],
    )


@router.post("/{video_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
def reprocess_video(
    video_id: uuid.UUID, session: SessionDep, publisher: PublisherDep
) -> VideoPublic:
    """Delete the results and run the analysis again (D3a)."""
    video, analysis = load_or_404(session, video_id)
    if analysis is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The video has not been uploaded")
    if not crud.restart_analysis(session, analysis.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "The video is being processed right now")
    streams.mark_dirty(video.id)
    # Respond only once the job is durable (D2). If publishing fails, the analysis stays queued
    # and a second Reprocess publishes again.
    publisher.publish_job(Job(analysis_id=analysis.id, video_id=video.id))
    session.refresh(analysis)
    return VideoPublic.from_db(video, analysis)


def existing_video_id(video_id: uuid.UUID, session: SessionDep) -> uuid.UUID:
    """A dependency, so an unknown id gets a real 404 before the stream starts."""
    if session.get(Video, video_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    return video_id


@router.get("/{video_id}/events", response_class=EventSourceResponse)
async def follow_video(
    video_id: Annotated[uuid.UUID, Depends(existing_video_id)], session: SessionDep
) -> AsyncIterable[VideoPublic]:
    """Send the video now and again on every change (D7). The stream ends after a finished
    analysis, or after STREAM_LIMIT_S, and the browser reconnects. FastAPI validates and
    serializes each video, documents it in the OpenAPI schema, and adds `: ping` while idle."""

    def read() -> VideoPublic:
        try:
            found = crud.load_video(session, video_id)
            assert found is not None
            return VideoPublic.from_db(*found)
        finally:
            # End the read's transaction: the connection goes back to the pool while the stream
            # waits, and the next read sees the latest commit instead of the rows it cached.
            session.close()

    loop = asyncio.get_running_loop()
    deadline = loop.time() + STREAM_LIMIT_S
    with streams.follow(video_id) as changed:  # register first, then read (D7)
        while True:
            video = await asyncify(read)()  # the session is synchronous: read in a thread
            yield video
            if video.analysis.state in ("done", "failed"):
                return
            try:
                await asyncio.wait_for(changed.wait(), timeout=deadline - loop.time())
            except TimeoutError:
                return
            changed.clear()  # before the re-read: a change during the read sets it again


def load_or_404(session: Session, video_id: uuid.UUID) -> tuple[Video, Analysis | None]:
    found = crud.load_video(session, video_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    return found
