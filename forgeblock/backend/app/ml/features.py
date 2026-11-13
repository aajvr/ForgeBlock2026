"""Feature analysis: how a questioned signature differs from a client's references.

The Siamese model compares 256-number embeddings and cannot say *why* two
signatures differ. This module measures plain handwriting features with
OpenCV / NumPy, compares the questioned signature with the client's own
references, and writes template sentences for the features outside the
client's usual range. It explains how the signature differs, not what the
model was thinking (that is the heatmap's job, see explain.py).

Static (from the ink of a scanned image):
    stroke_length, thickness, slant, baseline, aspect_ratio, ink_density,
    pieces (separate ink pieces, a proxy for pen lifts), loops, endpoints
Dynamic (from the pen points):
    duration, speed, pauses, pen_lifts, strokes, pressure, path_length
"""
import math

import cv2
import numpy as np

from .preprocessing import _enhance_and_mask, ink_mask

# name -> (label, unit, kind). kind decides how a difference is worded:
#   pct   - relative difference ("24% longer")
#   deg   - degrees ("12° more upright")
#   count - whole numbers ("2 extra pen lifts")
#   sec   - seconds
STATIC_FEATURES = {
    "stroke_length": ("Total stroke length", "× height", "pct"),
    "thickness": ("Stroke thickness", "% of height", "pct"),
    "slant": ("Slant", "°", "deg"),
    "baseline": ("Baseline tilt", "°", "deg"),
    "aspect_ratio": ("Width-to-height ratio", "", "pct"),
    "ink_density": ("Ink density", "%", "pct"),
    "pieces": ("Separate ink pieces (pen lifts)", "", "count"),
    "loops": ("Loops", "", "count"),
    "endpoints": ("Stroke endings", "", "count"),
}
DYNAMIC_FEATURES = {
    "duration": ("Signing time", "s", "sec"),
    "speed": ("Average speed", "heights/s", "pct"),
    "pauses": ("Pauses", "", "count"),
    "pen_lifts": ("Pen lifts", "", "count"),
    "strokes": ("Strokes", "", "count"),
    "pressure": ("Average pressure", "", "pct"),
    "path_length": ("Total pen path", "× height", "pct"),
}

# Smallest difference treated as meaningful, so very consistent references
# do not flag tiny changes.
_MIN_TOLERANCE = {"pct": 0.10, "deg": 4.0, "count": 1.0, "sec": 0.4}
_Z = 2.0  # outside mean ± 2 standard deviations of the references


# ------------------------------------------------------------ measuring ---

def _skeleton(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning (ink = 1), vectorized with NumPy."""
    img = np.pad((mask > 0).astype(np.uint8), 1)
    for _ in range(100):
        changed = False
        for step in (0, 1):
            p = img
            P2, P3, P4 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:]
            P5, P6, P7 = p[2:, 2:], p[2:, 1:-1], p[2:, :-2]
            P8, P9 = p[1:-1, :-2], p[:-2, :-2]
            nbrs = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(n.astype(np.int32) for n in nbrs)
            seq = nbrs + [P2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.int32) for i in range(8))
            if step == 0:
                c1, c2 = P2 * P4 * P6, P4 * P6 * P8
            else:
                c1, c2 = P2 * P4 * P8, P2 * P6 * P8
            remove = (p[1:-1, 1:-1] == 1) & (B >= 2) & (B <= 6) & (A == 1) & (c1 == 0) & (c2 == 0)
            if remove.any():
                img[1:-1, 1:-1][remove] = 0
                changed = True
        if not changed:
            break
    return img[1:-1, 1:-1]


def _slant(mask: np.ndarray) -> float:
    """Dominant lean of the near-vertical strokes, in degrees from upright
    (positive leans right), from the edge directions of the ink."""
    m = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (5, 5), 0)
    gx = cv2.Sobel(m, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(m, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    sel = mag > 0.2 * (mag.max() + 1e-9)
    tx, ty = -gy[sel], gx[sel]  # stroke direction is perpendicular to the gradient
    flip = ty > 0  # make every direction point up (image y grows downward)
    tx, ty = np.where(flip, -tx, tx), np.where(flip, -ty, ty)
    ang = np.degrees(np.arctan2(tx, -ty))
    w = mag[sel]
    keep = np.abs(ang) < 45
    if not keep.any():
        return 0.0
    ang, w = ang[keep], w[keep]
    order = np.argsort(ang)
    cum = np.cumsum(w[order])
    return float(ang[order][np.searchsorted(cum, cum[-1] / 2)])


def _static_measure(mask: np.ndarray) -> tuple[dict, dict]:
    """Measures a cropped ink mask (ink = 255). Returns (values, geometry):
    the values are what static_features reports; the geometry is what the
    feature-marks view needs to draw them (positions at the working scale)."""
    h, w = mask.shape
    # Work at a fixed height so measurements do not depend on scan resolution.
    scale = 150.0 / max(h, 1)
    m = cv2.resize(mask, (max(1, int(round(w * scale))), 150), interpolation=cv2.INTER_NEAREST)
    m = (m > 127).astype(np.uint8) * 255
    H, W = m.shape
    ink = int(np.count_nonzero(m))

    skel = _skeleton(m)
    skel_px = int(skel.sum())

    # Endpoints: skeleton pixels with exactly one neighbour.
    nb = cv2.filter2D(skel.astype(np.float32), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT)
    ends = (skel == 1) & (nb == 2)
    endpoints = int(np.count_nonzero(ends))

    slant = _slant(m)
    # Baseline tilt: line through the lowest ink point of each column
    # (positive rises to the right).
    cols = np.nonzero(m.any(axis=0))[0]
    bottoms = np.array([np.nonzero(m[:, c])[0].max() for c in cols], dtype=np.float64)
    baseline = 0.0
    baseline_fit = None
    if len(cols) > 10:
        lo = bottoms >= np.percentile(bottoms, 60)  # keep the low points (the baseline, not the loops above it)
        if lo.sum() > 5:
            k, b = np.polyfit(cols[lo], bottoms[lo], 1)
            baseline = -math.degrees(math.atan(k))
            baseline_fit = (float(k), float(b))

    n_pieces, _, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    pieces = int(np.sum(stats[1:, cv2.CC_STAT_AREA] >= 0.002 * H * W)) if n_pieces > 1 else 0

    contours, hierarchy = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    loop_contours = []
    if hierarchy is not None:
        for c, hinfo in zip(contours, hierarchy[0]):
            if hinfo[3] != -1 and cv2.contourArea(c) >= 12:  # a hole inside an ink piece
                loop_contours.append(c)

    values = {
        "stroke_length": round(skel_px / H, 3),
        "thickness": round(100.0 * ink / max(skel_px, 1) / H, 3),
        "slant": round(slant, 2),
        "baseline": round(baseline, 2),
        "aspect_ratio": round(W / H, 3),
        "ink_density": round(100.0 * ink / (H * W), 3),
        "pieces": pieces,
        "loops": len(loop_contours),
        "endpoints": endpoints,
    }
    geometry = {
        "m": m, "sx": W / max(w, 1), "sy": H / max(h, 1), "slant": slant, "ends": ends,
        "cols": cols, "baseline_fit": baseline_fit, "loop_contours": loop_contours,
    }
    return values, geometry


def static_features(img: np.ndarray) -> dict:
    """Measures the handwriting features of a scanned signature image."""
    mask = ink_mask(img)
    if mask.size == 0 or not mask.any():
        return {}
    return _static_measure(mask)[0]


# ------------------------------------------------------- feature marks ---
# Positions for drawing the features on the image (a visual aid in the
# result page's Overlay tab). Values come from the same _static_measure as
# static_features, so the marks always match the numbers.

def _ink_offset(img: np.ndarray) -> tuple[int, int]:
    """Top-left corner of ink_mask's crop in the original image. Repeats
    ink_mask's speck rule on the uncropped mask (tests check it matches)."""
    _, mask, _ = _enhance_and_mask(img)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    min_area = max(4, int(0.00005 * mask.size))
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    ys, xs = np.nonzero(keep[labels])
    if len(xs) == 0:
        return 0, 0
    return int(xs.min()), int(ys.min())


def static_feature_marks(img: np.ndarray) -> dict | None:
    """Where the static features are, in the image's own pixel coordinates:
    the ink box, slant and baseline lines, loops and stroke endings."""
    mask = ink_mask(img)
    if mask.size == 0 or not mask.any():
        return None
    vals, g = _static_measure(mask)
    x0, y0 = _ink_offset(img)
    h, w = mask.shape
    sx, sy = g["sx"], g["sy"]

    def back(x: float, y: float) -> list[float]:
        return [round(x / sx + x0, 1), round(y / sy + y0, 1)]

    m = g["m"]
    H = m.shape[0]
    ys, xs = np.nonzero(m)
    cx, cy = float(xs.mean()), float(ys.mean())
    half = 0.45 * H
    lean = math.tan(math.radians(g["slant"]))  # positive leans right: the top is further right
    slant_line = [back(cx - half * lean, cy + half), back(cx + half * lean, cy - half)]

    cols = g["cols"]
    if g["baseline_fit"] is not None:
        k, b = g["baseline_fit"]
        c1, c2 = float(cols[0]), float(cols[-1])
        base_line = [back(c1, k * c1 + b), back(c2, k * c2 + b)]
    else:
        bottom = float(np.nonzero(m.any(axis=1))[0].max())
        base_line = [back(0.0, bottom), back(float(m.shape[1] - 1), bottom)]

    loops = []
    for c in g["loop_contours"]:
        (lx, ly), r = cv2.minEnclosingCircle(c)
        px, py = back(lx, ly)
        loops.append({"cx": px, "cy": py, "r": round(float(r) / ((sx + sy) / 2), 1)})

    ey, ex = np.nonzero(g["ends"])
    endpoints = [back(float(x), float(y)) for x, y in zip(ex, ey)]

    ih, iw = img.shape[:2]
    return {
        "width": int(iw),
        "height": int(ih),
        "bbox": [x0, y0, int(w), int(h)],
        "width_height_ratio": vals["aspect_ratio"],
        "slant": {"angle_deg": vals["slant"], "line": slant_line},
        "baseline": {"line": base_line, "tilt_deg": vals["baseline"]},
        "loops": loops,
        "endpoints": endpoints,
        "pieces": vals["pieces"],
        "stroke_thickness": vals["thickness"],
        "ink_density": vals["ink_density"],
    }


def dynamic_features(strokes: list[list[dict]]) -> dict:
    """Measures timing and pen features from the captured strokes
    ({x, y, t, pressure?} per point)."""
    strokes = [s for s in strokes if s]
    if not strokes:
        return {}
    pts = [p for s in strokes for p in s]
    xs = np.array([float(p["x"]) for p in pts])
    ys = np.array([float(p["y"]) for p in pts])
    height = max(float(ys.max() - ys.min()), 1.0)
    t0 = float(strokes[0][0]["t"])
    t1 = float(strokes[-1][-1]["t"])
    duration = max((t1 - t0) / 1000.0, 1e-3)

    path, pen_down_time, pauses = 0.0, 0.0, 0
    for i, s in enumerate(strokes):
        sx = np.array([float(p["x"]) for p in s])
        sy = np.array([float(p["y"]) for p in s])
        st = np.array([float(p["t"]) for p in s])
        if len(s) > 1:
            path += float(np.sum(np.hypot(np.diff(sx), np.diff(sy))))
            pen_down_time += (st[-1] - st[0]) / 1000.0
            dt = np.diff(st)
            pauses += int(np.sum(dt > 150))  # pen held still while touching
        if i > 0 and float(s[0]["t"]) - float(strokes[i - 1][-1]["t"]) > 400:
            pauses += 1  # long gap between strokes
    pressures = [float(p["pressure"]) for p in pts if p.get("pressure") not in (None, 0, 0.5)]
    out = {
        "duration": round(duration, 3),
        "speed": round((path / height) / max(pen_down_time, 1e-3), 3),
        "pauses": pauses,
        "pen_lifts": len(strokes) - 1,
        "strokes": len(strokes),
        "path_length": round(path / height, 3),
    }
    if pressures:
        out["pressure"] = round(float(np.mean(pressures)), 4)
    return out


# ------------------------------------------------------------ comparing ---

def _sentence(label: str, kind: str, value: float, mean: float, lo: float, hi: float, name: str) -> str:
    above = value > hi
    if kind == "pct":
        pct = abs(value - mean) / (abs(mean) + 1e-9) * 100
        word = {
            "stroke_length": ("longer", "shorter"),
            "thickness": ("thicker", "thinner"),
            "speed": ("faster", "slower"),
            "path_length": ("longer", "shorter"),
        }.get(name, ("higher", "lower"))[0 if above else 1]
        return f"{label} is {pct:.0f}% {word} than this client's usual range."
    if kind == "deg":
        diff = abs(value - mean)
        if name == "slant":
            word = "more to the right" if above else "more upright or to the left"
            return f"Slant leans {diff:.0f}° {word} than the references."
        word = "rises" if above else "falls"
        return f"Baseline {word} {diff:.0f}° more than in the references."
    if kind == "sec":
        diff = abs(value - mean)
        return f"Signed {diff:.1f} s {'slower' if above else 'faster'} than usual."
    diff = int(round(abs(value - mean)))
    return f"{label}: {int(value)} vs usually {lo:.0f}–{hi:.0f} ({diff} {'more' if above else 'fewer'})."


def compare_features(test: dict, refs: list[dict], modality: str) -> dict:
    """Compares a questioned signature's features with the references.

    Returns {"items": [...], "flagged": n, "summary": [sentences]} where each
    item has the value, the client's usual range and whether it is outside.
    """
    spec = STATIC_FEATURES if modality == "static" else DYNAMIC_FEATURES
    refs = [r for r in refs if r]
    items, sentences = [], []
    for name, (label, unit, kind) in spec.items():
        if name not in test:
            continue
        vals = np.array([r[name] for r in refs if name in r], dtype=np.float64)
        value = float(test[name])
        if len(vals) < 2:
            items.append({"name": name, "label": label, "unit": unit, "value": value,
                          "mean": None, "low": None, "high": None, "outside": False})
            continue
        mean, std = float(vals.mean()), float(vals.std())
        tol = max(_Z * std, _MIN_TOLERANCE[kind] * (abs(mean) if kind == "pct" else 1.0))
        lo, hi = mean - tol, mean + tol
        if kind == "count":
            lo, hi = max(0.0, math.floor(lo)), math.ceil(hi)
        outside = value < lo or value > hi
        items.append({"name": name, "label": label, "unit": unit, "value": round(value, 3),
                      "mean": round(mean, 3), "low": round(lo, 3), "high": round(hi, 3), "outside": outside})
        if outside:
            sentences.append(_sentence(label, kind, value, mean, lo, hi, name))
    # Explicit dynamic hint that examiners recognise.
    if modality == "dynamic":
        slower = any(i["name"] == "duration" and i["outside"] and i["value"] > (i["high"] or 0) for i in items)
        more_lifts = any(i["name"] in ("pen_lifts", "pauses") and i["outside"] and i["value"] > (i["high"] or 0)
                         for i in items)
        if slower and more_lifts:
            sentences.append("Slow signing with extra pauses or pen lifts is common in copied signatures.")
    within = [i["label"] for i in items if i["mean"] is not None and not i["outside"]]
    if within and len(sentences) == 0:
        sentences.append("All measured features are within this client's usual range.")
    return {"items": items, "flagged": sum(i["outside"] for i in items), "summary": sentences}
