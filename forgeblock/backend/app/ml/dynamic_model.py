"""Dynamic module plug-in point.

`load_dynamic_model(weights_dir)` returns an object with:

    .embed(points) -> 1-D numpy embedding (L2-normalized)
        points: numpy array of shape (N, 7) with columns x, y (browser
        pixels, y pointing down), t (ms), pen state (1 down / 0 up),
        azimuth and altitude (degrees, Pointer Events convention) and
        pressure (0-1); NaN where the device did not report a channel. As
        produced by dynamic_features.points_from_payload.
    .trained       -> bool, True when real weights are loaded
    .kind          -> short label shown in /api/health
    .source        -> weights file name or None
    .default_config (optional) -> default thresholds/bounds for engine.py
    .capture_device(points) (optional) -> "standard", or "development" for a
        pen without tilt accepted only because DEV_PEN_DEVICES is on

backend/weights/dynamic_encoder.pt can hold either
  * a checkpoint exported by the team's SVC2004 notebook (svc_dynamic_colab,
    cell C810: a dict with "model_state", "cfg", "features", "scaler", ...),
    loaded by SvcDynamicModel; or
  * a plain state dict for the reference CNN-BiLSTM encoder in networks.py
    (training/train_dynamic.py), loaded by TorchDynamicModel.
Without the file the reference encoder runs as an untrained placeholder.
"""
from pathlib import Path

import numpy as np

TORCH_FILENAME = "dynamic_encoder.pt"
MIN_PEN_DOWN = 10
PEN_REQUIRED = ("This dynamic model needs Apple Pencil input (pen pressure and angle). "
                "Please sign again with the Apple Pencil.")
ORIENTATION_FEATURES = ("azimuth_sin", "azimuth_cos", "altitude")


def _dev_pen_devices() -> bool:
    from .. import config

    return config.DEV_PEN_DEVICES


def load_checkpoint(path: Path) -> dict:
    """torch.load without arbitrary pickles; the notebook's checkpoints also
    store the torch version object."""
    import torch
    from torch.torch_version import TorchVersion

    with torch.serialization.safe_globals([TorchVersion]):
        return torch.load(path, map_location="cpu", weights_only=True)


class TorchDynamicModel:
    def __init__(self, path: Path | None, state: dict | None = None):
        import torch

        from .dynamic_features import stroke_features
        from .networks import DynamicEncoder

        self._torch = torch
        self._features = stroke_features
        torch.manual_seed(0)  # deterministic placeholder embeddings
        self.model = DynamicEncoder().eval()
        self.trained = path is not None
        if path is not None:
            state = state if state is not None else load_checkpoint(path)
            self.model.load_state_dict(state.get("state_dict", state))
        self.kind = "pytorch" if self.trained else "placeholder"
        self.source = path.name if path else None

    def embed(self, points: np.ndarray) -> np.ndarray:
        torch = self._torch
        with torch.inference_mode():
            x = torch.from_numpy(self._features(points)).unsqueeze(0)
            e = self.model(x)[0].numpy().astype(np.float64)
        return e / (np.linalg.norm(e) + 1e-12)


def _carry(v: np.ndarray) -> np.ndarray:
    """Fill NaNs with the previous value (the first value for leading NaNs)."""
    ok = np.isfinite(v)
    if not ok.any():
        return np.zeros_like(v)
    idx = np.where(ok, np.arange(len(v)), 0)
    np.maximum.accumulate(idx, out=idx)
    out = v[idx]
    return np.where(np.isfinite(out), out, v[np.flatnonzero(ok)[0]])


class SvcDynamicModel:
    """Siamese CNN-BiLSTM from the SVC2004 notebook. Preprocessing, feature
    scaling and units come from the checkpoint, so inference matches the
    notebook's predict.py.

    Browser points are converted to the SVC2004 Task 2 conventions the model
    was trained on (the same ones the collector writes): y pointing up,
    azimuth and altitude in tenths of a degree with azimuth measured
    clockwise from 12 o'clock (Pointer Events measure it from 3 o'clock, so
    +90 degrees), pressure 0-1023.
    """

    def __init__(self, path: Path, ck: dict):
        import torch

        from .svc_dynamic.config import Config
        from .svc_dynamic.preprocess import FeatureScaler, FeatureSpec, PreprocParams
        from .svc_dynamic.siamese_cnn_lstm import SiameseCNNLSTM

        self._torch = torch
        self.cfg = Config.from_dict(ck["cfg"])
        self.spec = FeatureSpec.from_dict(ck["features"])
        self.params = PreprocParams.from_dict(ck["preproc"])
        self.scaler = FeatureScaler.from_dict(ck["scaler"])
        self.model = SiameseCNNLSTM(ck["in_dim"], self.cfg)
        self.model.load_state_dict(ck["model_state"])
        self.model.eval()
        names = set(self.spec.names)
        self.needs_pressure = bool(names & {"pressure", "dpressure"})
        self.needs_orientation = bool(names & {"azimuth_sin", "azimuth_cos", "altitude"})
        self.trained = True
        self.kind = "pytorch-svc"
        self.source = path.name
        self.default_config = self._default_config(ck)

    @staticmethod
    def _default_config(ck: dict) -> dict:
        """The notebook picks a mean-Euclidean-distance threshold on validation
        users; for unit vectors cosine = 1 - d^2 / 2. The 5-reference (enroll)
        threshold is the default; the single-pair threshold, the loosest one
        validation supports, is the lower clip bound for personal thresholds."""
        thr = ck["thresholds"]
        cos_enroll = 1 - float(thr.get("enroll", thr["pairs"])) ** 2 / 2
        cos_pairs = 1 - float(thr["pairs"]) ** 2 / 2
        return {
            "thresholds": {"cosine": round(cos_enroll, 4)},
            "bounds": {"cosine": [round(min(cos_pairs, cos_enroll), 4), 0.95]},
        }

    @staticmethod
    def _channels(pts: np.ndarray) -> tuple[bool, bool]:
        """Whether the pen reported changing angles and changing pressure."""
        down = pts[:, 3] > 0.5
        az, alt, pr = pts[:, 4], pts[:, 5], pts[:, 6]
        has_angles = bool(np.isfinite(az[down]).all() and np.isfinite(alt[down]).all()
                          and (np.ptp(az[down]) > 0 or np.ptp(alt[down]) > 0))
        has_pressure = bool(np.isfinite(pr[down]).all() and np.ptp(pr[down]) > 1e-6)
        return has_angles, has_pressure

    def capture_device(self, points: np.ndarray) -> str:
        """"development" when the pen has no tilt (only accepted with
        DEV_PEN_DEVICES on), else "standard"."""
        pts = np.asarray(points, dtype=np.float64)
        if pts.ndim != 2 or pts.shape[1] < 7 or len(pts) == 0:
            return "standard"
        return "development" if self.needs_orientation and not self._channels(pts)[0] else "standard"

    def _raw(self, points: np.ndarray) -> tuple[np.ndarray, tuple]:
        """Browser points -> SVC2004 raw rows (N, 7) and the present-channel flags."""
        pts = np.asarray(points, dtype=np.float64)
        if pts.ndim != 2 or pts.shape[1] < 4:
            raise ValueError("Each point needs x, y, t and pen state.")
        if pts.shape[1] < 7:
            pts = np.hstack([pts, np.full((len(pts), 7 - pts.shape[1]), np.nan)])
        pts = pts[np.all(np.isfinite(pts[:, :4]), axis=1)]
        pts = pts[np.argsort(pts[:, 2], kind="stable")]
        down = pts[:, 3] > 0.5
        if down.sum() < MIN_PEN_DOWN:
            raise ValueError("The signature is too short. Please sign again.")

        has_angles, has_pressure = self._channels(pts)
        if self.needs_pressure and not has_pressure:
            raise ValueError(PEN_REQUIRED)
        if self.needs_orientation and not has_angles and not _dev_pen_devices():
            raise ValueError(PEN_REQUIRED)
        az, alt, pr = pts[:, 4], pts[:, 5], pts[:, 6]

        raw = np.full((len(pts), 7), np.nan)
        raw[:, 0] = pts[:, 0]
        raw[:, 1] = -pts[:, 1]
        raw[:, 2] = pts[:, 2]
        raw[:, 3] = pts[:, 3]
        if has_angles:
            raw[:, 4] = np.deg2rad((_carry(az) + 90.0) % 360.0) / self.params.az_scale
            raw[:, 5] = np.deg2rad(_carry(alt)) / self.params.alt_scale
        if has_pressure:
            raw[:, 6] = np.where(down, np.nan_to_num(pr), 0.0) * 1023.0
        return raw, (True, True, True, True, has_angles, has_angles, has_pressure)

    def features(self, points: np.ndarray) -> tuple[np.ndarray, int]:
        """Scaled (T, F) feature matrix and its valid length."""
        from .svc_dynamic.preprocess import compute_features, normalize_signature, resample

        raw, present = self._raw(points)
        c = self.cfg
        norm = normalize_signature(raw, present, self.params.time_for("default"), self.params.az_scale,
                                   self.params.alt_scale, c.scale_mode, c.min_points)
        if norm is None:
            raise ValueError("The signature is too short. Please sign again.")
        res, length, dt = resample(norm, c.T, c.resample_mode, c.rate_hz, c.gap_factor)
        feats = compute_features(res, length, dt, self.spec.names, c.smooth_window)
        x = self.scaler.transform(feats, length)
        if not present[4]:
            # Development pen without tilt: the angle features get their
            # training average (0 after standardization) instead of a
            # meaningless constant angle.
            for name in ORIENTATION_FEATURES:
                if name in self.spec.names:
                    x[:length, self.spec.names.index(name)] = 0.0
        return x, length

    def embed(self, points: np.ndarray) -> np.ndarray:
        torch = self._torch
        x, length = self.features(points)
        with torch.inference_mode():
            e = self.model.encode(torch.from_numpy(x)[None], torch.tensor([length]))[0]
        e = e.numpy().astype(np.float64)
        return e / (np.linalg.norm(e) + 1e-12)


def load_model_file(path: Path):
    """Loads either kind of weights file (raises if it is neither)."""
    ck = load_checkpoint(path)
    if isinstance(ck, dict) and "model_state" in ck:
        return SvcDynamicModel(path, ck)
    return TorchDynamicModel(path, ck)


def load_dynamic_model(weights_dir: Path):
    path = weights_dir / TORCH_FILENAME
    return load_model_file(path) if path.exists() else TorchDynamicModel(None)
