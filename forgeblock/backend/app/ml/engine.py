"""Loads both verification models once and turns inputs into embeddings.

Model files live in backend/weights/ (see static_model.py and
dynamic_model.py for what is looked for). Each module also reads an optional
config JSON holding its default thresholds and the clipping bounds for
adaptive thresholds:
    static_config.json, dynamic_config.json
Without a config the defaults below are used; a dynamic model can supply
its own defaults (SvcDynamicModel takes them from its checkpoint).

Calibration (v8.5): weights/calibration.json holds the Platt parameters
(a, b) per module, keyed by a fingerprint of the model they were fitted
for, so a calibration is never applied to a different model:
    static  - first 16 hex of the SHA-256 of static_model.keras
    dynamic - "thr:" + the checkpoint's enroll threshold (6 decimals)
A model without a matching entry keeps the uncalibrated v8.2 confidence.
"""
import hashlib
import json
import logging
import threading
from pathlib import Path

import numpy as np

from ..config import WEIGHTS_DIR
from .dynamic_model import (BASIC_FILENAME, PEN_CHANNELS, TorchDynamicModel, load_dynamic_model, load_model_file,
                            missing_from_key, mode_key)
from .preprocessing import preprocess_signature
from .static_model import load_static_model

log = logging.getLogger(__name__)

DEFAULT_STATIC_CONFIG = {
    "thresholds": {"cosine": 0.80, "euclidean": 0.63, "manhattan": 5.6},
    "bounds": {"cosine": [0.50, 0.97], "euclidean": [0.25, 1.00], "manhattan": [2.2, 9.0]},
}
DEFAULT_DYNAMIC_CONFIG = {
    "thresholds": {"cosine": 0.80},
    "bounds": {"cosine": [0.50, 0.97]},
}


def _load_config(path: Path, default: dict) -> dict:
    cfg = json.loads(path.read_text()) if path.exists() else {}
    return {
        **default,
        **cfg,
        "thresholds": {**default["thresholds"], **cfg.get("thresholds", {})},
        "bounds": {**default["bounds"], **cfg.get("bounds", {})},
    }


def _file_fingerprint(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _dynamic_fingerprint(model) -> str | None:
    thr = getattr(model, "checkpoint_thresholds", None)
    if not thr:
        return None
    return f"thr:{float(thr.get('enroll', thr.get('pairs'))):.6f}"


def _load_calibration(path: Path, module: str, fingerprint: str | None) -> dict | None:
    if not fingerprint or not path.exists():
        return None
    try:
        entry = json.loads(path.read_text()).get(module, {}).get(fingerprint)
    except (ValueError, AttributeError):
        log.exception("weights/calibration.json is not valid JSON; confidence stays uncalibrated")
        return None
    if entry and "a" in entry and "b" in entry:
        return {**entry, "fingerprint": fingerprint}
    return None


def _version(model, modality: str) -> str:
    return f"{modality}-{model.kind}" + (f":{model.source}" if model.source else "")


class Engine:
    def __init__(self, weights_dir: Path = WEIGHTS_DIR):
        self._lock = threading.Lock()
        self.static_model = load_static_model(weights_dir)
        self.dynamic_error = None
        try:
            self.dynamic_model = load_dynamic_model(weights_dir)
        except Exception as e:  # a bad dynamic file must not take the static module down
            log.exception("Could not load the dynamic model; using the placeholder")
            self.dynamic_error = f"{type(e).__name__}: {e}"
            self.dynamic_model = TorchDynamicModel(None)
        # v8.11: optional model trained without pen pressure and tilt (the
        # notebook's OWN_E3), used for signatures that lack pen tilt.
        self.dynamic_basic_model = None
        basic = weights_dir / BASIC_FILENAME
        if basic.exists() and not self.dynamic_error:
            try:
                m = load_model_file(basic)
                if getattr(m, "used_channels", None) == frozenset() and m.trained:
                    self.dynamic_basic_model = m
                else:
                    log.warning("%s uses pen pressure or tilt; it is ignored (it must be a base-features model)",
                                BASIC_FILENAME)
            except Exception:
                log.exception("Could not load %s; limited signatures use the main dynamic model", BASIC_FILENAME)
        self.static_cfg = _load_config(weights_dir / "static_config.json", DEFAULT_STATIC_CONFIG)
        self.dynamic_cfg = _load_config(weights_dir / "dynamic_config.json",
                                        getattr(self.dynamic_model, "default_config", DEFAULT_DYNAMIC_CONFIG))
        self.static_cfg["model_version"] = _version(self.static_model, "static")
        self.dynamic_cfg["model_version"] = _version(self.dynamic_model, "dynamic") + (
            "+basic" if self.dynamic_basic_model else "")  # column is 60 characters
        self.dynamic_basic_cfg = None
        if self.dynamic_basic_model is not None:
            self.dynamic_basic_cfg = _load_config(weights_dir / "dynamic_basic_config.json",
                                                  getattr(self.dynamic_basic_model, "default_config",
                                                          DEFAULT_DYNAMIC_CONFIG))
            self.dynamic_basic_cfg["model_version"] = self.dynamic_cfg["model_version"]
            self.dynamic_basic_cfg["calibration"] = None
        cal = weights_dir / "calibration.json"
        self.static_fingerprint = _file_fingerprint(weights_dir / "static_model.keras")
        self.dynamic_fingerprint = _dynamic_fingerprint(self.dynamic_model)
        self.static_cfg["calibration"] = _load_calibration(cal, "static", self.static_fingerprint)
        self.dynamic_cfg["calibration"] = _load_calibration(cal, "dynamic", self.dynamic_fingerprint)
        for name, fp, c in (("static", self.static_fingerprint, self.static_cfg["calibration"]),
                            ("dynamic", self.dynamic_fingerprint, self.dynamic_cfg["calibration"])):
            log.info("%s confidence: %s (model fingerprint %s)", name,
                     "calibrated" if c else "uncalibrated (v8.2 z-score)", fp)

    def static_embedding(self, img: np.ndarray) -> np.ndarray:
        x = preprocess_signature(img)
        with self._lock:
            return self.static_model.embed(x)

    def static_embed_preprocessed(self, batch: np.ndarray) -> np.ndarray:
        """Embeds already preprocessed images (B, 224, 224, 3); used by the heatmap."""
        with self._lock:
            return self.static_model.embed_batch(batch)

    def dynamic_embedding(self, points: np.ndarray) -> np.ndarray:
        with self._lock:
            return self.dynamic_model.embed(points)

    def dynamic_missing(self, points: np.ndarray) -> frozenset:
        """Pen channels ("tilt", "pressure") the main model uses but the signature lacks."""
        fn = getattr(self.dynamic_model, "missing_channels", None)
        return fn(points) if fn else frozenset()

    def dynamic_capture_device(self, points: np.ndarray) -> str:
        """"limited" when the signature lacks pen pressure and/or tilt, else "standard"."""
        return "limited" if self.dynamic_missing(points) else "standard"

    def _uses_basic(self, mode: str) -> bool:
        return self.dynamic_basic_model is not None and "tilt" in missing_from_key(mode)

    def dynamic_mode_embedding(self, points: np.ndarray, mode: str) -> np.ndarray:
        """Embedding for a comparison mode ("full", "no_tilt", "no_pressure",
        "basic"): the channels the mode leaves out are not used. Without
        tilt, the base-features model is used when it is installed."""
        with self._lock:
            if self._uses_basic(mode):
                return self.dynamic_basic_model.embed(points)
            if mode == "full":
                return self.dynamic_model.embed(points)
            return self.dynamic_model.embed(points, missing=missing_from_key(mode))

    def dynamic_mode_embeddings(self, points: np.ndarray) -> tuple[frozenset, dict]:
        """The signature's missing channels and its embedding in every mode it
        can be compared in (its own mode and every mode that leaves out more)."""
        missing = self.dynamic_missing(points)
        modes = {mode_key(m) for m in (missing, missing | {"tilt"}, missing | {"pressure"},
                                       missing | set(PEN_CHANNELS))}
        if not getattr(self.dynamic_model, "used_channels", None):
            modes = {"full"}  # placeholder / reference encoder: no channel modes
        return missing, {m: self.dynamic_mode_embedding(points, m).tolist() for m in sorted(modes)}

    def dynamic_cfg_for(self, mode: str) -> dict:
        return self.dynamic_basic_cfg if self._uses_basic(mode) else self.dynamic_cfg

    def status(self) -> dict:
        def one(model, cfg):
            return {
                "trained": model.trained,
                "kind": model.kind,
                "model_version": cfg["model_version"],
                "default_thresholds": cfg["thresholds"],
                "evaluation": cfg.get("evaluation"),
                "confidence": "calibrated" if cfg.get("calibration") else "uncalibrated",
            }

        out = {"static": one(self.static_model, self.static_cfg), "dynamic": one(self.dynamic_model, self.dynamic_cfg)}
        out["dynamic"]["limited_pen_data_model"] = (self.dynamic_basic_model.source if self.dynamic_basic_model
                                                    else "main model without the missing channels")
        if self.dynamic_error:
            out["dynamic"]["load_error"] = self.dynamic_error
        return out


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine
