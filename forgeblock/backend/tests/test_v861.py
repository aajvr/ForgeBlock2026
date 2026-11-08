"""v8.6.1: printed lines are erased from static uploads; sheet crops stay natural."""
import cv2
import numpy as np

from app.ml import capture, enroll_sheet
from app.ml.preprocessing import ink_mask


def _photo_with_box_lines():
    rng = np.random.default_rng(1)
    img = np.full((600, 900), 175, np.float32) + rng.normal(0, 3, (600, 900))
    cv2.line(img, (0, 80), (899, 84), 40, 4)     # top box border
    cv2.line(img, (0, 470), (899, 466), 40, 4)   # bottom box border
    pts = np.array([[250, 330], [330, 220], [380, 300], [450, 210], [520, 320], [600, 260]], np.int32)
    cv2.polylines(img, [pts], False, 60, 3)      # the signature
    return cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)


def test_box_lines_are_not_ink():
    img = _photo_with_box_lines()
    assert ink_mask(img).shape[0] > 350          # before: crop spans both lines
    out = capture.standardize(img)
    assert out.shape == img.shape                # never cropped or resized
    h, w = ink_mask(out).shape
    assert h < 160 and w < 420                   # after: just the signature


def test_signature_strokes_survive():
    img = _photo_with_box_lines()
    out = cv2.cvtColor(capture.standardize(img), cv2.COLOR_BGR2GRAY)
    assert out[300, 380 - 1: 380 + 2].min() < 110 or out[295:305, 375:385].min() < 110


def test_clean_scan_is_unchanged():
    img = np.full((300, 500, 3), 245, np.uint8)
    cv2.putText(img, "Abc", (60, 200), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 4, (70, 70, 70), 3)
    assert np.array_equal(capture.standardize(img), img)


def test_sheet_crops_are_not_whitened():
    page = enroll_sheet.render_raster(dpi=enroll_sheet.WORK_DPI)
    page = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY) if page.ndim == 3 else page
    grey = np.clip(page.astype(np.int16) - 60, 0, 255).astype(np.uint8)  # grey paper photo
    boxes = enroll_sheet.crop_boxes(grey)
    assert all(b["empty"] for b in boxes)
    assert 150 < float(np.median(boxes[0]["image"])) < 220                 # paper kept as photographed
