from pathlib import Path

import pytest

from app.pipeline import probe as probe_module
from app.pipeline.probe import NotProcessable, VideoInfo, frame_size, probe


def test_a_landscape_mp4(clips: dict[str, Path]) -> None:
    info = probe(clips["landscape"])
    assert (info.width, info.height, info.codec) == (320, 180, "h264")
    assert info.duration_s == pytest.approx(3, abs=0.1)


def test_non_square_pixels_are_stretched_to_the_display_size(clips: dict[str, Path]) -> None:
    info = probe(clips["wide_pixels"])  # coded 160×180, pixels twice as wide as tall
    assert (info.width, info.height) == (320, 180)


def test_a_rotated_video_reports_its_upright_size(clips: dict[str, Path]) -> None:
    info = probe(clips["rotated"])  # coded 320×180, displayed turned by 90°
    assert (info.width, info.height) == (180, 320)


@pytest.mark.parametrize(
    ("clip", "reason"),
    [
        ("garbage", "Not a valid MP4."),
        ("quicktime", "Not a valid MP4."),  # a .mov renamed to .mp4: excluded by its brand
        ("audio_only", "The file has no video track."),
    ],
)
def test_files_that_cannot_be_processed(clips: dict[str, Path], clip: str, reason: str) -> None:
    with pytest.raises(NotProcessable, match=reason):
        probe(clips[clip])


def test_a_video_too_long_to_process(
    clips: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(probe_module, "MAX_DURATION_S", 1)
    with pytest.raises(NotProcessable, match="too long"):
        probe(clips["landscape"])


def test_frames_keep_the_display_aspect_with_an_even_long_side_of_640() -> None:
    assert frame_size(VideoInfo(3, 320, 180, "h264"), 640) == (640, 360)
    assert frame_size(VideoInfo(3, 180, 320, "h264"), 640) == (360, 640)
    width, height = frame_size(VideoInfo(3, 1000, 333, "h264"), 640)
    assert (width, height % 2) == (640, 0)
