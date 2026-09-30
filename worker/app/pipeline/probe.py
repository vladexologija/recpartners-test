"""ffprobe: the final format gate (D9, layer 4), and the display size frames are sampled at."""

import json
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

from app.core.config import MAX_DURATION_S

# MP4 brands accepted (D9). ffprobe reports the whole MP4/QuickTime family as one format, so the
# brand is what excludes QuickTime (`qt  `), e.g. a .mov renamed to .mp4.
MP4_BRANDS = {"isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1"}

PROBE_TIMEOUT_S = 60


class NotProcessable(Exception):
    """A permanent problem with the file. The message is shown to the user."""


@dataclass(frozen=True)
class VideoInfo:
    duration_s: float
    width: int  # the display size: pixel aspect ratio and rotation applied, as browsers show it
    height: int
    codec: str


def probe(path: Path) -> VideoInfo:
    command = [
        "ffprobe",
        *("-v", "error", "-of", "json"),
        "-show_entries",
        "format=format_name,duration:format_tags=major_brand"
        ":stream=codec_type,codec_name,width,height,sample_aspect_ratio"
        ":stream_side_data=rotation",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=PROBE_TIMEOUT_S)
    if result.returncode != 0:
        raise NotProcessable("Not a valid MP4.")
    found: dict[str, Any] = json.loads(result.stdout)
    container = found.get("format", {})
    brand = container.get("tags", {}).get("major_brand", "").strip()
    if "mp4" not in container.get("format_name", "") or brand not in MP4_BRANDS:
        raise NotProcessable("Not a valid MP4.")
    video = next((s for s in found.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        raise NotProcessable("The file has no video track.")
    duration = float(container.get("duration", 0))
    if duration <= 0:
        raise NotProcessable("Not a valid MP4.")
    if duration > MAX_DURATION_S:
        raise NotProcessable(
            f"The video is too long to process ({duration / 60:.0f} min; "
            f"the limit is {MAX_DURATION_S // 60} min)."
        )
    width, height = display_size(video)
    return VideoInfo(duration_s=duration, width=width, height=height, codec=video["codec_name"])


def display_size(stream: dict[str, Any]) -> tuple[int, int]:
    """Coded size → display size: stretch by the pixel aspect ratio, then swap for ±90°."""
    width, height = int(stream["width"]), int(stream["height"])
    try:
        pixel_aspect = Fraction(stream.get("sample_aspect_ratio", "1:1").replace(":", "/"))
    except (ValueError, ZeroDivisionError):
        pixel_aspect = Fraction(1)
    if pixel_aspect > 0:
        width = round(width * pixel_aspect)
    rotation = next(
        (int(side["rotation"]) for side in stream.get("side_data_list", []) if "rotation" in side),
        0,
    )
    return (height, width) if abs(rotation) % 180 == 90 else (width, height)


def frame_size(info: VideoInfo, long_side: int) -> tuple[int, int]:
    """The size frames are sampled at: the display aspect, long side `long_side`, both even."""
    scale = long_side / max(info.width, info.height)
    return (_even(info.width * scale), _even(info.height * scale))


def _even(value: float) -> int:
    return max(2, round(value / 2) * 2)
