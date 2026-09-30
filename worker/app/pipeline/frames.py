"""Samples frames with the ffmpeg CLI (Part 2 §5): it auto-rotates like browsers do, and its fps
filter is safe for variable frame rates. Frames come out at the display size, in BGR."""

import itertools
import logging
import subprocess
import tempfile
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from app.pipeline.probe import NotProcessable

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Frame:
    sample_idx: int
    t_seconds: float  # sample_idx / fps: no start-offset subtraction, matching browsers
    pixels: npt.NDArray[np.uint8]  # height × width × 3, BGR (what ultralytics expects of numpy)


def sample_frames(path: Path, size: tuple[int, int], fps: int) -> Generator[Frame]:
    """Yield frames at `fps`, scaled to `size` (width, height). Close the generator
    (contextlib.closing) so ffmpeg is always stopped."""
    width, height = size
    frame_bytes = width * height * 3
    command = [
        *("ffmpeg", "-nostdin", "-v", "error", "-i", str(path)),
        *("-an", "-sn", "-dn", "-vf", f"fps={fps},scale={width}:{height}"),
        *("-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"),
    ]
    # stderr goes to a file: a pipe nobody reads could fill up and stall ffmpeg. Its end is logged
    # if ffmpeg fails, so the logs say why a video could not be decoded.
    with tempfile.TemporaryFile() as stderr:
        # Popen, not run(): run() would wait for ffmpeg to finish and keep all of its output in
        # memory; this reads one frame at a time while ffmpeg keeps decoding.
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr)
        assert process.stdout is not None
        try:
            for sample_idx in itertools.count():
                data = process.stdout.read(frame_bytes)
                if len(data) < frame_bytes:
                    break
                pixels = np.frombuffer(data, np.uint8).reshape(height, width, 3)
                yield Frame(sample_idx=sample_idx, t_seconds=sample_idx / fps, pixels=pixels)
            if process.wait() != 0:
                stderr.seek(0)
                reason = stderr.read()[-2000:].decode(errors="replace").strip()
                log.warning("ffmpeg could not decode %s: %s", path, reason)
                raise NotProcessable("The video could not be decoded.")
        finally:
            process.kill()
            process.wait()
