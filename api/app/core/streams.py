"""The open event streams of this process, per video (D7).

After committing a change to a video, call `streams.mark_dirty(video_id)`: every stream
following that video re-reads it and sends it. One web instance holds every stream
(max_instance_count = 1); more instances would need a shared channel (NOTES).
"""

import asyncio
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

Follower = tuple[asyncio.AbstractEventLoop, asyncio.Event]


class Streams:
    def __init__(self) -> None:
        self._followers: dict[uuid.UUID, set[Follower]] = {}
        self._lock = threading.Lock()

    @contextmanager
    def follow(self, video_id: uuid.UUID) -> Iterator[asyncio.Event]:
        """Register a stream for the video; the returned flag is set on every change.

        Register first, then read and send (D7): a change committed in between then sets the
        flag, so it cannot be lost.
        """
        follower = (asyncio.get_running_loop(), asyncio.Event())
        with self._lock:
            self._followers.setdefault(video_id, set()).add(follower)
        try:
            yield follower[1]
        finally:
            with self._lock:
                followers = self._followers[video_id]
                followers.discard(follower)
                if not followers:
                    del self._followers[video_id]

    def mark_dirty(self, video_id: uuid.UUID) -> None:
        """Safe from any thread: sync routes run in FastAPI's thread pool, not the event loop."""
        with self._lock:
            followers = list(self._followers.get(video_id, ()))
        for loop, dirty in followers:
            loop.call_soon_threadsafe(dirty.set)

    def count(self, video_id: uuid.UUID) -> int:
        with self._lock:
            return len(self._followers.get(video_id, ()))


streams = Streams()
