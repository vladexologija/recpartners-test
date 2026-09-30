import shutil
import subprocess
import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_detector, get_publisher, get_settings, get_storage
from app.core.config import Settings
from app.gcp.pubsub import Event
from app.main import app
from app.messages import Job
from app.pipeline.detector import Box


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


@pytest.fixture(scope="session")
def clips(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Small test videos, generated with ffmpeg rather than committed."""
    folder = tmp_path_factory.mktemp("clips")
    h264 = ("-c:v", "libx264", "-pix_fmt", "yuv420p")
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=3", *h264,
           str(folder / "landscape.mp4"))  # fmt: skip
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=160x180:rate=10:duration=3", "-vf", "setsar=2",
           *h264, str(folder / "wide_pixels.mp4"))  # fmt: skip
    ffmpeg("-display_rotation", "90", "-i", str(folder / "landscape.mp4"), "-c", "copy",
           str(folder / "rotated.mp4"))  # fmt: skip
    ffmpeg("-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", str(folder / "audio_only.mp4"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=1", *h264, "-f", "mov",
           str(folder / "quicktime.mp4"))  # fmt: skip
    (folder / "garbage.mp4").write_bytes(b"not a video at all" * 100)
    return {path.stem: path for path in folder.iterdir()}


class FakeStorage:
    """Serves one local clip as the uploaded video, and remembers where it put it."""

    def __init__(self, clip: Path) -> None:
        self.clip = clip
        self.downloaded_to: Path | None = None

    def download(self, object_name: str, destination: Path) -> None:
        shutil.copyfile(self.clip, destination)
        self.downloaded_to = destination


class FakePublisher:
    """Records events instead of sending them; can refuse events of chosen types."""

    def __init__(self) -> None:
        self.events: list[Event] = []
        self.refuse: set[str] = set()

    def publish(self, event: Event) -> None:
        if event.type in self.refuse:
            raise ConnectionError(f"Pub/Sub refused the {event.type} event")
        self.events.append(event)

    @property
    def types(self) -> list[str]:
        return [event.type for event in self.events]


class FakeDetector:
    """Finds the given boxes in the n-th frame it is shown (counting across calls)."""

    def __init__(self, boxes: dict[int, list[Box]] | None = None) -> None:
        self.boxes = boxes or {}
        self.frames_seen = 0

    def detect(self, frames: Sequence[npt.NDArray[np.uint8]]) -> list[list[Box]]:
        found = [self.boxes.get(self.frames_seen + i, []) for i in range(len(frames))]
        self.frames_seen += len(frames)
        return found


@pytest.fixture
def job() -> Job:
    return Job(analysis_id=uuid.uuid4(), video_id=uuid.uuid4())


@pytest.fixture
def publisher() -> FakePublisher:
    return FakePublisher()


@pytest.fixture
def client(clips: dict[str, Path], publisher: FakePublisher) -> Iterator[TestClient]:
    """The worker app with GCS, Pub/Sub and the model replaced by fakes. Not entered as a
    context manager, so the startup hook does not load the real model."""
    app.dependency_overrides[get_settings] = lambda: Settings(project_id="p", bucket="b")
    app.dependency_overrides[get_storage] = lambda: FakeStorage(clips["landscape"])
    app.dependency_overrides[get_publisher] = lambda: publisher
    app.dependency_overrides[get_detector] = lambda: FakeDetector()
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()
