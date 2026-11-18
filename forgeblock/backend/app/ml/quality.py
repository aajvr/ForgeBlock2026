"""Input quality checks, so a bad photo or a blank box is not screened as if
it were a signature. Each check returns a score (0-100), a list of issues and
whether the input is usable at all."""
import cv2
import numpy as np

from .dynamic_features import points_from_payload
from .dynamic_model import pen_channels_present
from .preprocessing import ink_mask

# --- Dynamic signature checks (enrollment and screening) ---
# A gap longer than this (pen resting or lifted) is a long pause.
LONG_PAUSE_S = 3.0
# A gap longer than this makes the signature unusable.
UNUSABLE_PAUSE_S = 8.0
# Score taken off for a long pause.
LONG_PAUSE_PENALTY = 25
# A signature longer than this overall is unusually long.
LONG_DURATION_S = 15.0
# Score taken off for an unusually long signature.
LONG_DURATION_PENALTY = 20
# A stroke with fewer points than this may be a stray tap...
STRAY_MAX_POINTS = 5
# ...as may a stroke shorter than this share of the total path length...
STRAY_MAX_PATH_SHARE = 0.02
# ...when it starts farther than this share of the rest's width from the rest.
STRAY_MIN_DISTANCE = 0.25
# Score taken off for a stray mark (not rejected: it may be a real mark).
STRAY_PENALTY = 15
# Score taken off when no pen pressure was recorded.
NO_PRESSURE_PENALTY = 10


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


def _longest_gap_s(strokes: list[list[dict]]) -> float:
    """Longest time between consecutive points in a stroke, or between the
    end of one stroke and the start of the next, in seconds."""
    gap, prev = 0.0, None
    for s in strokes:
        for p in s:
            t = float(p["t"])
            if prev is not None:
                gap = max(gap, t - prev)
            prev = t
    return gap / 1000.0


def _path(s: list[dict]) -> float:
    return float(sum(np.hypot(float(b["x"]) - float(a["x"]), float(b["y"]) - float(a["y"]))
                     for a, b in zip(s, s[1:])))


def _has_stray_mark(strokes: list[list[dict]]) -> bool:
    """A tiny stroke (a tap or palm touch) that starts away from the rest.
    Dots on an i or j are small but close to the rest, so they do not count."""
    if len(strokes) < 2:
        return False
    paths = [_path(s) for s in strokes]
    total = sum(paths) or 1.0
    for i, s in enumerate(strokes):
        if len(s) >= STRAY_MAX_POINTS and paths[i] >= STRAY_MAX_PATH_SHARE * total:
            continue
        rest = [p for j, o in enumerate(strokes) if j != i for p in o]
        rx = [float(p["x"]) for p in rest]
        ry = [float(p["y"]) for p in rest]
        width = max(max(rx) - min(rx), max(ry) - min(ry), 1.0)
        x0, y0 = float(s[0]["x"]), float(s[0]["y"])
        dx = max(min(rx) - x0, 0.0, x0 - max(rx))
        dy = max(min(ry) - y0, 0.0, y0 - max(ry))
        if np.hypot(dx, dy) > STRAY_MIN_DISTANCE * width:
            return True
    return False


def has_pen_pressure(strokes: list[list[dict]]) -> bool:
    """Same rule as the dynamic model's "Limited pen data" (dynamic_model.
    pen_channels_present): pressure missing, or constant over the signature."""
    try:
        return pen_channels_present(points_from_payload(strokes))[1]
    except (ValueError, KeyError, TypeError):
        return False


def dynamic_quality(strokes: list[list[dict]]) -> dict:
    issues, score = [], 100.0
    strokes = [s for s in strokes if s]
    pts = [p for s in strokes for p in s]
    if len(pts) < 20:
        return {"score": 0.0, "usable": False, "issues": ["The signature is too short. Please sign again."]}
    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    duration = (pts[-1]["t"] - pts[0]["t"]) / 1000.0
    usable = True
    if duration < 0.3:
        issues.append("The signature was drawn very quickly; it may be a stray mark.")
        score -= 40
    gap = _longest_gap_s(strokes)
    if gap > LONG_PAUSE_S:
        issues.append("There was a long pause while signing (pen resting or lifted for several seconds). "
                      "Sign again in one go.")
        score -= LONG_PAUSE_PENALTY
        if gap > UNUSABLE_PAUSE_S:
            usable = False
    if duration > LONG_DURATION_S:
        issues.append("The signature took unusually long.")
        score -= LONG_DURATION_PENALTY
    if max(width, height) < 40:
        issues.append("The signature is very small. Use more of the signing box.")
        score -= 30
    if _has_stray_mark(strokes):
        issues.append("A stray mark was recorded (a tap or palm touch).")
        score -= STRAY_PENALTY
    if not has_pen_pressure(strokes):
        issues.append("No pen pressure was recorded (mouse or finger input).")
        score -= NO_PRESSURE_PENALTY
    score = max(0.0, score)
    return {"score": round(score, 1), "usable": usable and score >= 30, "issues": issues}
