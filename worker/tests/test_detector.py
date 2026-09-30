from pathlib import Path
from typing import cast

import numpy as np
import pytest

from app.pipeline.detector import YoloDetector, valid_boxes

MODEL = Path(__file__).resolve().parents[1] / "models" / "yolo26n.pt"
needs_model = pytest.mark.skipif(
    not MODEL.exists(), reason="the weights are missing: run `make model`"
)


def test_boxes_are_clipped_to_the_frame_and_empty_ones_dropped() -> None:
    boxes = valid_boxes(
        [[-0.1, 0.2, 0.5, 1.2], [0.3, 0.3, 0.3, 0.6], [0.1, 0.1, 0.2, 0.2]],
        [0.5, 0.9, 0.8],
    )
    assert [(box.confidence, box.x1, box.y2) for box in boxes] == [(0.8, 0.1, 0.2), (0.5, 0.0, 1.0)]


def test_at_most_ten_boxes_per_frame_most_confident_first() -> None:
    corners = [[0.1, 0.1, 0.2, 0.2]] * 12
    boxes = valid_boxes(corners, [i / 20 for i in range(1, 13)])
    assert len(boxes) == 10
    assert boxes[0].confidence == 0.6


@needs_model
def test_the_real_model_sees_the_bus_but_no_hot_dog() -> None:
    import cv2  # imported here, like torch, so the other tests stay fast
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.engine.results import Results

    image = cv2.imread(str(Path(ultralytics.__file__).parent / "assets" / "bus.jpg"))
    assert image is not None
    bus = np.asarray(image, dtype=np.uint8)  # BGR, like our frames
    result = cast("list[Results]", YOLO(str(MODEL)).predict(bus, verbose=False))[0]
    assert result.boxes is not None
    assert {"bus", "person"} <= {result.names[int(c)] for c in result.boxes.cls.tolist()}
    assert YoloDetector(str(MODEL)).detect([bus]) == [[]]  # only hot dogs are asked for


@needs_model
def test_the_detector_keeps_the_thread_count_it_is_given() -> None:
    import torch

    detector = YoloDetector(str(MODEL), threads=2)  # ultralytics' own setup would pick another
    detector.detect([np.zeros((64, 64, 3), np.uint8)])
    assert torch.get_num_threads() == 2
