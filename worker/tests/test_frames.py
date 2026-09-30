from contextlib import closing
from pathlib import Path

import pytest

from app.pipeline.frames import sample_frames
from app.pipeline.probe import NotProcessable

FAR_AWAY = 1e9


def test_two_frames_per_second_at_the_display_size(clips: dict[str, Path]) -> None:
    with closing(sample_frames(clips["landscape"], (640, 360), 2)) as got:
        frames = list(got)
    assert [frame.sample_idx for frame in frames] == [0, 1, 2, 3, 4, 5]
    assert [frame.t_seconds for frame in frames] == [0, 0.5, 1, 1.5, 2, 2.5]  # t = k / fps
    assert frames[0].pixels.shape == (360, 640, 3)


def test_a_rotated_video_is_sampled_upright(clips: dict[str, Path]) -> None:
    with closing(sample_frames(clips["rotated"], (360, 640), 2)) as got:
        first = next(got)
    assert first.pixels.shape == (640, 360, 3)  # ffmpeg auto-rotates, as browsers do


def test_an_undecodable_file_is_refused_and_ffmpeg_s_reason_is_logged(
    clips: dict[str, Path], caplog: pytest.LogCaptureFixture
) -> None:
    with (
        pytest.raises(NotProcessable),
        closing(sample_frames(clips["garbage"], (320, 180), 2)) as got,
    ):
        list(got)
    assert "Invalid data" in caplog.text  # ffmpeg's own words, for whoever reads the logs
