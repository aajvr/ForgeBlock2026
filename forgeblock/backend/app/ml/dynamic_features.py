"""Stroke-sequence preprocessing for the dynamic module (Chapter 3, Algorithm 2).

Input points are (x, y, t, b): coordinates, timestamp in milliseconds and pen
state (1 = touching, 0 = lifted). The browser capture page and the SVC2004
loader both produce this format. The sequence is resampled to a fixed length
and converted to 9 features per step:

    [x_norm, y_norm, dx, dy, velocity, acceleration, direction, curvature, pen]
"""
import numpy as np

from .networks import DYNAMIC_SEQ_LEN

EPS = 1e-6
MIN_POINTS = 10


def clean_points(points: np.ndarray) -> np.ndarray:
    """Drop rows with missing values and duplicate timestamps; sort by time."""
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] < 4:
        raise ValueError("Each point needs x, y, t and pen state.")
    pts = pts[:, :4]
    pts = pts[np.all(np.isfinite(pts), axis=1)]
    pts = pts[np.argsort(pts[:, 2], kind="stable")]
    if len(pts) > 1:
        keep = np.concatenate([[True], np.diff(pts[:, 2]) > 0])
        pts = pts[keep]
    if len(pts) < MIN_POINTS or pts[:, 3].sum() < MIN_POINTS:
        raise ValueError("The signature is too short. Please sign again.")
    return pts


def resample(points: np.ndarray, length: int = DYNAMIC_SEQ_LEN) -> np.ndarray:
    """Linear interpolation over the point index; pen state uses nearest point."""
    n = len(points)
    src = np.arange(n)
    dst = np.linspace(0, n - 1, length)
    out = np.empty((length, 4))
    for c in range(3):
        out[:, c] = np.interp(dst, src, points[:, c])
    out[:, 3] = points[np.rint(dst).astype(int), 3]
    return out


def _zscore(v: np.ndarray) -> np.ndarray:
    return (v - v.mean()) / (v.std() + EPS)


def stroke_features(points, length: int = DYNAMIC_SEQ_LEN) -> np.ndarray:
    """Return a float32 feature matrix of shape (length, 9)."""
    pts = resample(clean_points(points), length)
    x, y, t, b = pts[:, 0], pts[:, 1], pts[:, 2], pts[:, 3]

    # Scale both axes by the larger range so the aspect ratio is kept.
    span = max(x.max() - x.min(), y.max() - y.min()) + EPS
    xn = (x - x.min()) / span
    yn = (y - y.min()) / span

    dx = np.diff(xn, prepend=xn[0])
    dy = np.diff(yn, prepend=yn[0])
    dt = np.maximum(np.diff(t, prepend=t[0]), EPS)
    dt[0] = np.median(dt[1:]) if length > 1 else 1.0

    v = np.sqrt(dx**2 + dy**2) / dt
    a = np.diff(v, prepend=v[0]) / dt
    theta = np.arctan2(dy, dx)
    kappa = np.diff(theta, prepend=theta[0])
    kappa = (kappa + np.pi) % (2 * np.pi) - np.pi

    feats = np.stack(
        [xn, yn, _zscore(dx), _zscore(dy), _zscore(v), _zscore(a), theta / np.pi, kappa / np.pi, b],
        axis=1,
    )
    return feats.astype(np.float32)


def _angles(p: dict, use_tilt: bool) -> tuple[float, float]:
    """Pen azimuth and altitude in degrees (Pointer Events convention:
    azimuth clockwise from 3 o'clock, altitude 90 = upright). Taken from
    azimuth/altitude when the pad sent them, else derived from tiltX/tiltY
    (the same conversion as the collector)."""
    if p.get("azimuth") is not None and p.get("altitude") is not None:
        return float(p["azimuth"]), float(p["altitude"])
    if not use_tilt:
        return np.nan, np.nan
    tx = np.tan(np.deg2rad(float(p.get("tiltX") or 0)))
    ty = np.tan(np.deg2rad(float(p.get("tiltY") or 0)))
    if tx == 0 and ty == 0:
        return 0.0, 90.0
    return float(np.rad2deg(np.arctan2(ty, tx)) % 360), float(np.rad2deg(np.arctan(1 / np.hypot(tx, ty))))


def points_from_payload(strokes: list[list[dict]]) -> np.ndarray:
    """Convert the browser payload (list of strokes, each a list of
    {x, y, t, pressure?, azimuth?, altitude?, tiltX?, tiltY?}) into rows
    (x, y, t, b, azimuth, altitude, pressure), inserting a pen-up point after
    each stroke as described in Section 3.4.2. Channels the device did not
    report are NaN (tilt that is 0 everywhere means mouse or finger)."""
    pts = [p for s in strokes for p in s]
    use_tilt = any(p.get("tiltX") or p.get("tiltY") for p in pts)
    rows = []
    for stroke in strokes:
        if not stroke:
            continue
        for p in stroke:
            az, alt = _angles(p, use_tilt)
            pr = p.get("pressure")
            rows.append([float(p["x"]), float(p["y"]), float(p["t"]), 1.0, az, alt,
                         np.nan if pr is None else float(pr)])
        last = rows[-1]
        rows.append([last[0], last[1], last[2] + 1.0, 0.0, last[4], last[5], 0.0])
    if not rows:
        raise ValueError("No signature strokes were received.")
    return np.array(rows)
