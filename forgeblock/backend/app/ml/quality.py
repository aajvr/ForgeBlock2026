"""Input quality checks, so a bad photo or a blank box is not screened as if
it were a signature. Each check returns a score (0-100), a list of issues and
whether the input is usable at all."""
import cv2
import numpy as np

from .preprocessing import ink_mask


def static_quality(img: np.ndarray) -> dict:
    issues, score, usable = [], 100.0, True
    h, w = img.shape[:2]
    if min(h, w) < 60:
        return {"score": 0.0, "usable": False, "issues": ["The image is too small. Scan at 300 dpi or take a closer photo."]}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    mask = ink_mask(img)
    ink_ratio = float(np.count_nonzero(mask)) / float(h * w) if mask.size else 0.0
    if mask.size == 0 or ink_ratio < 0.0008:
        return {"score": 0.0, "usable": False, "issues": ["No signature was found. The image looks blank."]}

    mh, mw = mask.shape
    if mw < 0.08 * w and mh < 0.08 * h:
        issues.append("The signature is very small in the image. Crop closer to it.")
        score -= 25
    if ink_ratio > 0.35:
        issues.append("A lot of the image is dark. Make sure only the signature is in the picture.")
        score -= 30

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if sharpness < 15:
        issues.append("The image looks blurry.")
        score -= 30

    contrast = float(gray.std())
    if contrast < 12:
        issues.append("Low contrast between ink and paper.")
        score -= 20

    score = max(0.0, score)
    if score < 30:
        usable = False
    return {"score": round(score, 1), "usable": usable, "issues": issues}


def dynamic_quality(strokes: list[list[dict]]) -> dict:
    issues, score = [], 100.0
    pts = [p for s in strokes for p in s]
    if len(pts) < 20:
        return {"score": 0.0, "usable": False, "issues": ["The signature is too short. Please sign again."]}
    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    duration = (pts[-1]["t"] - pts[0]["t"]) / 1000.0
    if duration < 0.3:
        issues.append("The signature was drawn very quickly; it may be a stray mark.")
        score -= 40
    if max(width, height) < 40:
        issues.append("The signature is very small. Use more of the signing box.")
        score -= 30
    if not any(p.get("pressure") not in (None, 0, 0.5) for p in pts):
        issues.append("No pen pressure was recorded (mouse or finger input).")
        score -= 10
    score = max(0.0, score)
    return {"score": round(score, 1), "usable": score >= 30, "issues": issues}
