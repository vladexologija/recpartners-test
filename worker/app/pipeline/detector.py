"""The hot-dog detector: YOLO26 nano through ultralytics (D4)."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, cast

import numpy as np
import numpy.typing as npt

from app.core.config import (
    HOT_DOG_CLASS,
    MAX_BOXES_PER_FRAME,
    MIN_CONFIDENCE,
    MODEL_IMAGE_SIZE,
)

if TYPE_CHECKING:
    from ultralytics.engine.results import Results


@dataclass(frozen=True)
class Box:
    confidence: float
    x1: float  # corners normalized to the frame, which has the video's display aspect
    y1: float
    x2: float
    y2: float


class Detector(Protocol):
    def detect(self, frames: Sequence[npt.NDArray[np.uint8]]) -> list[list[Box]]:
        """Boxes per frame, most confident first."""
        ...


class YoloDetector:
    def __init__(self, model_path: str, threads: int | None = None) -> None:
        # Imports torch, so only when the model is actually loaded.
        from ultralytics import YOLO

        self._model = YOLO(model_path)
        # Ultralytics sets itself up on the first prediction and resets torch to
        # min(8, CPUs - 1) threads. Predict once now, which also spares the first job
        # that setup, then apply the instance's own count (D4).
        self.detect([np.zeros((MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE, 3), np.uint8)])
        if threads is not None:
            import torch

            torch.set_num_threads(threads)

    def detect(self, frames: Sequence[npt.NDArray[np.uint8]]) -> list[list[Box]]:
        # Without stream=True, a detection model returns one Results per frame.
        predicted = self._model.predict(
            list(frames),
            classes=[HOT_DOG_CLASS],
            conf=MIN_CONFIDENCE,
            imgsz=MODEL_IMAGE_SIZE,
            max_det=MAX_BOXES_PER_FRAME,
            verbose=False,
        )
        found: list[list[Box]] = []
        for result in cast("list[Results]", predicted):
            boxes = result.boxes  # None only for models that do not detect boxes
            if boxes is None:
                found.append([])
            else:
                found.append(valid_boxes(boxes.xyxyn.tolist(), boxes.conf.tolist()))
        return found


def valid_boxes(corners: list[list[float]], confidences: list[float]) -> list[Box]:
    """Clip to the frame and drop boxes with no area: the API stores only boxes that satisfy
    0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1, and would refuse the whole result otherwise.
    """
    boxes = []
    for (x1, y1, x2, y2), confidence in zip(corners, confidences, strict=True):
        x1, y1, x2, y2 = (min(max(v, 0.0), 1.0) for v in (x1, y1, x2, y2))
        if x1 < x2 and y1 < y2 and 0 < confidence <= 1:
            boxes.append(Box(confidence=confidence, x1=x1, y1=y1, x2=x2, y2=y2))
    return sorted(boxes, key=lambda box: box.confidence, reverse=True)[:MAX_BOXES_PER_FRAME]
