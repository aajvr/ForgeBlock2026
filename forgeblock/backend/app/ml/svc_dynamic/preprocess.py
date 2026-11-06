# [C150] FILES · data/preprocess.py
"""Dataset-agnostic preprocessing: normalisation, resampling, feature extraction, scaling.

Pipeline per signature:  parsed raw (N,7)  ->  normalize_signature  ->  [augment]  ->
resample (fixed T steps or fixed rate)  ->  compute_features  ->  FeatureScaler (train stats only).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.ndimage import uniform_filter1d

from .config import (BASE_FEATURES, FEATURE_GROUPS, FEATURE_REQUIRES, ORIENTATION_FEATURES,
                    PRESSURE_FEATURES, parse_flag)

log = logging.getLogger(__name__)

#: columns of a *normalised* signature array
NORM_COLS: Tuple[str, ...] = ("x", "y", "t", "pen", "az_sin", "az_cos", "alt", "pressure")
_UNITS = {"s": 1.0, "ms": 1e-3, "us": 1e-6}


# --------------------------------------------------------------------------- #
# Feature spec
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class FeatureSpec:
    """Which input features a run uses. ``dim`` is derived, never hardcoded."""
    names: Tuple[str, ...]
    groups: Dict[str, Tuple[str, ...]]
    dropped: Dict[str, str] = field(default_factory=dict)

    @property
    def dim(self) -> int:
        return len(self.names)

    def describe(self) -> str:
        g = ", ".join(f"{k}({len(v)})" for k, v in self.groups.items())
        d = f" | dropped: {self.dropped}" if self.dropped else ""
        return f"{self.dim} features [{g}]: {list(self.names)}{d}"

    def to_dict(self) -> dict:
        return {"names": list(self.names), "groups": {k: list(v) for k, v in self.groups.items()},
                "dropped": dict(self.dropped)}

    @classmethod
    def from_dict(cls, d: dict) -> "FeatureSpec":
        return cls(tuple(d["names"]), {k: tuple(v) for k, v in d["groups"].items()}, dict(d.get("dropped", {})))


def resolve_feature_spec(use_pressure, use_orientation, informative: Sequence[str]) -> FeatureSpec:
    """Decide the active feature set from flags and the channels the dataset really provides.

    ``"auto"`` -> use a group iff its channels are informative; ``True`` -> required (raises if
    unavailable - we never silently feed zeros); ``False`` -> off.
    """
    informative = set(informative)
    for need in ("x", "y", "t"):
        if need not in informative:
            raise ValueError(f"Channel '{need}' is missing/constant in this dataset (informative: {sorted(informative)})")
    groups: Dict[str, Tuple[str, ...]] = {}
    dropped: Dict[str, str] = {}
    base = []
    for f in BASE_FEATURES:
        if all(c in informative or c in ("x", "y", "t") for c in FEATURE_REQUIRES[f]):
            base.append(f)
        else:
            dropped[f] = f"needs {FEATURE_REQUIRES[f]}"
            log.warning("BASE feature %s dropped: channel(s) %s not informative", f, FEATURE_REQUIRES[f])
    groups["BASE"] = tuple(base)
    for group, flag, feats in (("ORIENTATION", parse_flag(use_orientation), ORIENTATION_FEATURES),
                               ("PRESSURE", parse_flag(use_pressure), PRESSURE_FEATURES)):
        need = sorted({c for f in feats for c in FEATURE_REQUIRES[f] if c != "t"})
        avail = all(c in informative for c in need)
        if flag is True and not avail:
            raise ValueError(f"{group} was requested (True) but channel(s) {need} are not informative in "
                             f"this dataset (informative: {sorted(informative)}). Use 'auto' or False.")
        if flag is not False and avail:
            groups[group] = tuple(feats)
        elif flag == "auto" and not avail:
            log.info("%s features unavailable in this dataset -> not used (auto).", group)
    names = tuple(f for g in groups.values() for f in g)
    return FeatureSpec(names, groups, dropped)


# --------------------------------------------------------------------------- #
# Unit inference / normalisation
# --------------------------------------------------------------------------- #
def infer_time_scale(durations: Sequence[float], unit: str = "auto") -> Tuple[float, str]:
    """Multiplier converting raw timestamps to seconds (dataset-level, from the median duration)."""
    if unit != "auto":
        return _UNITS[unit], unit
    med = float(np.median(durations))
    for name, sc in (("s", 1.0), ("ms", 1e-3), ("us", 1e-6)):
        if 0.2 <= med * sc <= 30.0:
            return sc, name
    log.warning("Cannot infer timestamp unit (median raw duration %.3g); assuming ms.", med)
    return 1e-3, "ms"


def infer_angle_scale(max_abs: float, kind: str) -> float:
    """Multiplier converting raw azimuth/altitude to radians (rad, deg or tenths of a degree)."""
    limit_rad = 2 * np.pi * 1.01 if kind == "azimuth" else 1.6
    limit_deg = 360.5 if kind == "azimuth" else 90.5
    if max_abs <= limit_rad:
        return 1.0
    if max_abs <= limit_deg:
        return np.pi / 180.0
    return np.pi / 1800.0


@dataclass
class PreprocParams:
    """Dataset-level unit conversions; saved with the checkpoint so inference matches training."""
    time_scale: Dict[str, float] = field(default_factory=dict)  # per task, plus "default"
    az_scale: float = 1.0
    alt_scale: float = 1.0

    def to_dict(self) -> dict:
        return {"time_scale": dict(self.time_scale), "az_scale": float(self.az_scale),
                "alt_scale": float(self.alt_scale)}

    @classmethod
    def from_dict(cls, d: dict) -> "PreprocParams":
        return cls(dict(d["time_scale"]), float(d["az_scale"]), float(d["alt_scale"]))

    def time_for(self, task: str) -> float:
        return self.time_scale.get(task, self.time_scale.get("default", 1e-3))


def normalize_signature(data: np.ndarray, present: Sequence[bool], time_scale: float, az_scale: float,
                        alt_scale: float, scale_mode: str = "bbox", min_points: int = 8) -> Optional[np.ndarray]:
    """Raw (N,7) -> normalised (N, len(NORM_COLS)). Returns None for unusable signatures.

    * translate to centroid, scale by bbox (max side) or std - same factor for x and y
      (aspect ratio preserved); computed on pen-down points when available
    * timestamps -> seconds, start at 0, made monotone (duplicate-heavy stamps fall back to a
      constant rate)
    * azimuth -> (sin, cos); altitude -> radians; missing channels stay NaN
    """
    n = len(data)
    if n < min_points:
        return None
    x, y, t = data[:, 0].copy(), data[:, 1].copy(), data[:, 2].copy()
    t = np.maximum.accumulate(t - t[0]) * time_scale
    if len(np.unique(t)) < 0.5 * n:  # coarse / broken timestamps -> assume constant rate
        pos = np.diff(t)[np.diff(t) > 0]
        step = float(np.median(pos)) if len(pos) else 0.01
        t = np.arange(n) * step
    t = t + np.arange(n) * 1e-9  # strictly increasing for interpolation
    if t[-1] - t[0] <= 0:
        return None
    pen = (data[:, 3] > 0.5).astype(np.float64) if present[3] else np.full(n, np.nan)
    ref = pen > 0.5 if present[3] and (pen > 0.5).sum() >= 3 else np.ones(n, bool)
    cx, cy = x[ref].mean(), y[ref].mean()
    x, y = x - cx, y - cy
    if scale_mode == "bbox":
        s = max(np.ptp(x[ref]), np.ptp(y[ref]))
    else:
        s = np.sqrt(0.5 * (x[ref].var() + y[ref].var()))
    s = s if s > 1e-8 else 1.0
    x, y = x / s, y / s
    out = np.full((n, len(NORM_COLS)), np.nan)
    out[:, 0], out[:, 1], out[:, 2], out[:, 3] = x, y, t, pen
    if present[4]:
        a = data[:, 4] * az_scale
        out[:, 4], out[:, 5] = np.sin(a), np.cos(a)
    if present[5]:
        out[:, 6] = data[:, 5] * alt_scale
    if present[6]:
        out[:, 7] = data[:, 6]
    return out


def resample(norm: np.ndarray, T: int, mode: str = "steps", rate_hz: float = 100.0,
             gap_factor: float = 5.0) -> Tuple[np.ndarray, int, float]:
    """Resample to ``T`` uniform steps (``steps``) or to ``rate_hz`` (``rate``; pad/truncate to T).

    Returns ``(array (T, 8), valid_length, dt_seconds)``. The pen state is interpolated as a step
    function; grid points that fall inside a pen-up *gap* (no samples for > gap_factor x median dt)
    are forced to pen-up with zero pressure so the model never sees a fake pen-down stroke.
    """
    t = norm[:, 2]
    dur = t[-1] - t[0]
    if mode == "steps":
        tg, length, dt = np.linspace(0.0, dur, T), T, dur / (T - 1)
    else:
        dt = 1.0 / rate_hz
        length = int(max(2, min(T, np.floor(dur / dt) + 1)))
        tg = np.arange(length) * dt
    out = np.zeros((T, norm.shape[1]))
    for c in (0, 1, 4, 5, 6, 7):
        col = norm[:, c]
        out[:length, c] = 0.0 if np.isnan(col).all() else np.interp(tg, t, col)
    pen = norm[:, 3]
    out[:length, 3] = 1.0 if np.isnan(pen).all() else (np.interp(tg, t, pen) > 0.5).astype(float)
    dts = np.diff(t)
    pos = dts[dts > 1e-6]
    if len(pos):
        for k in np.where(dts > gap_factor * np.median(pos))[0]:
            inside = (tg > t[k]) & (tg < t[k + 1])
            out[:length][inside, 3] = 0.0
            out[:length][inside, 7] = 0.0
    return out, length, float(dt)


def _smooth(v: np.ndarray, w: int) -> np.ndarray:
    return uniform_filter1d(v, size=w, mode="nearest") if w > 1 else v


def _slog(v: np.ndarray) -> np.ndarray:
    return np.sign(v) * np.log1p(np.abs(v))


def compute_features(res: np.ndarray, length: int, dt: float, names: Sequence[str],
                     smooth_window: int = 5) -> np.ndarray:
    """Build the (T, F) feature matrix in the order of ``names`` (padded steps are zero)."""
    T = res.shape[0]
    L = length
    x, y = res[:L, 0], res[:L, 1]
    xs, ys = _smooth(x, smooth_window), _smooth(y, smooth_window)
    vx, vy = np.gradient(xs, dt), np.gradient(ys, dt)
    speed = np.hypot(vx, vy)
    acc = np.gradient(_smooth(speed, smooth_window), dt)
    moving = speed > 1e-3 * max(speed.max(), 1e-9)
    theta = np.arctan2(vy, vx)
    dth = np.arctan2(np.sin(np.diff(theta, prepend=theta[0])), np.cos(np.diff(theta, prepend=theta[0])))
    curv = np.where(moving, dth / (speed * dt + 1e-6), 0.0)
    feats = {
        "x": x, "y": y, "dx": vx, "dy": vy, "speed": speed, "acc": _slog(acc), "pen": res[:L, 3],
        "theta_sin": np.where(moving, np.sin(theta), 0.0), "theta_cos": np.where(moving, np.cos(theta), 0.0),
        "curvature": _slog(curv),
        "azimuth_sin": res[:L, 4], "azimuth_cos": res[:L, 5], "altitude": res[:L, 6],
        "pressure": res[:L, 7], "dpressure": _slog(np.gradient(_smooth(res[:L, 7], smooth_window), dt)),
    }
    out = np.zeros((T, len(names)), dtype=np.float32)
    for k, n in enumerate(names):
        out[:L, k] = feats[n]
    return out


class FeatureScaler:
    """Per-feature standardisation with statistics from the TRAIN split only."""

    def __init__(self, names: Sequence[str], skip: Sequence[str] = ("pen",)):
        self.names = list(names)
        self.skip = [n for n in skip if n in self.names]
        self.mean = np.zeros(len(self.names), np.float32)
        self.std = np.ones(len(self.names), np.float32)

    def fit(self, X: np.ndarray, lengths: np.ndarray) -> "FeatureScaler":
        mask = np.arange(X.shape[1])[None, :] < np.asarray(lengths)[:, None]
        flat = X[mask]
        self.mean = flat.mean(0).astype(np.float32)
        self.std = np.maximum(flat.std(0), 1e-6).astype(np.float32)
        for n in self.skip:
            k = self.names.index(n)
            self.mean[k], self.std[k] = 0.0, 1.0
        return self

    def transform(self, X: np.ndarray, lengths) -> np.ndarray:
        single = X.ndim == 2
        Xb = X[None] if single else X
        lens = np.atleast_1d(np.asarray(lengths))
        out = (Xb - self.mean) / self.std
        out[np.arange(Xb.shape[1])[None, :] >= lens[:, None]] = 0.0
        return (out[0] if single else out).astype(np.float32)

    def to_dict(self) -> dict:
        return {"names": self.names, "skip": self.skip, "mean": self.mean.tolist(), "std": self.std.tolist()}

    @classmethod
    def from_dict(cls, d: dict) -> "FeatureScaler":
        s = cls(d["names"], d.get("skip", ()))
        s.mean, s.std = np.asarray(d["mean"], np.float32), np.asarray(d["std"], np.float32)
        return s
