"""Capture standardization for static signature images (v8.6.1).

Every static image (uploaded reference, sheet crop, questioned scan or phone
photo) passes through `standardize` before the Chapter 3 preprocessing in
preprocessing.py, which stays identical to training. It only erases long
straight printed lines (box borders, ruled lines, underlines of a form) by
inpainting them from the surrounding paper. Without this, the printed lines
count as ink, the crop stretches to include them and the signature ends up
small and faint in what the model sees.

The image is deliberately NOT cropped, resized, whitened or re-toned. On the
CEDAR test writers (47-55, 10 references each) SigNet scored AUC 0.957 on the
plain scans; erasing lines kept it at 0.956, while tight cropping (0.76-0.84),
whitening the paper (0.86) or shrinking photos (0.57-0.67) all lowered it. On
simulated phone photos of the same signatures with printed lines, erasing the
lines raised AUC from 0.70 to 0.79. References and questioned images must get
the same treatment: references whitened but a questioned photo left natural
dropped AUC to 0.26.
"""
import cv2
import numpy as np

LINE_FRACTION = 0.5   # a straight run at least this share of the width (height) is a printed line
SIDE_BAND = 0.15      # vertical lines are only erased this close to the left/right edge


def _gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _ink(gray: np.ndarray) -> np.ndarray:
    k = max(3, (min(gray.shape) // 6) | 1)
    norm = cv2.divide(gray, cv2.medianBlur(gray, min(k, 51)), scale=255)
    t, _ = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return (norm < min(t, 235)).astype(np.uint8) * 255


def line_mask(gray: np.ndarray) -> np.ndarray:
    """Pixels of long horizontal lines anywhere and long vertical lines near the sides.
    The ink is first thickened across the line direction so that slightly tilted
    lines in a hand-held photo still form one long straight run."""
    ink = _ink(gray)
    h, w = ink.shape
    t = max(7, (min(h, w) // 60) | 1)
    rect = cv2.getStructuringElement
    gap_w, gap_h = max(9, w // 30), max(9, h // 30)  # bridge small breaks along a line
    thick = cv2.dilate(ink, rect(cv2.MORPH_RECT, (1, t)))
    thick = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, rect(cv2.MORPH_RECT, (gap_w, 1)))
    horiz = cv2.morphologyEx(thick, cv2.MORPH_OPEN, rect(cv2.MORPH_RECT, (max(25, int(w * LINE_FRACTION)), 1)))
    thick = cv2.dilate(ink, rect(cv2.MORPH_RECT, (t, 1)))
    thick = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, rect(cv2.MORPH_RECT, (1, gap_h)))
    vert = cv2.morphologyEx(thick, cv2.MORPH_OPEN, rect(cv2.MORPH_RECT, (1, max(25, int(h * LINE_FRACTION)))))
    vert[:, int(w * SIDE_BAND): int(w * (1 - SIDE_BAND))] = 0
    lines = (horiz | vert) & ink
    d = max(5, (min(h, w) // 80) | 1)
    return cv2.dilate(lines, np.ones((d, d), np.uint8))


def standardize(img: np.ndarray) -> np.ndarray:
    """Return a BGR image of the same size with printed lines inpainted away."""
    gray = _gray(img)
    lines = line_mask(gray)
    if lines.any():
        gray = cv2.inpaint(gray, lines, 5, cv2.INPAINT_TELEA)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
