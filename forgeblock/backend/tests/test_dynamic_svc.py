"""The SVC2004 notebook model (backend/weights/dynamic_encoder.pt). Run from backend/:  pytest -q"""
from pathlib import Path

import numpy as np
import pytest

from app.ml.dynamic_features import points_from_payload
from app.ml.dynamic_model import PEN_REQUIRED, SvcDynamicModel, load_dynamic_model
from app.ml.engine import Engine

WEIGHTS = Path(__file__).resolve().parents[1] / "weights"
pytestmark = pytest.mark.skipif(not (WEIGHTS / "dynamic_encoder.pt").exists(), reason="no trained dynamic model")


def pencil(seed: int) -> list:
    rng = np.random.default_rng(seed)
    out, t = [], 0.0
    for k in range(3):
        stroke = []
        for i in range(80):
            t += 4 + rng.normal(0, 0.3)
            stroke.append({"x": 60 + 120 * k + 2.2 * i, "y": 150 + 40 * np.sin(i / (7 + k)), "t": t,
                           "pressure": 0.4 + 0.2 * np.sin(i / 11 + k), "tiltX": 30, "tiltY": 20,
                           "azimuth": 40 + 8 * np.sin(i / 30), "altitude": 55 + 4 * np.cos(i / 25)})
        out.append(stroke)
        t += 180
    return out


@pytest.fixture(scope="module")
def model():
    m = load_dynamic_model(WEIGHTS)
    assert isinstance(m, SvcDynamicModel) and m.trained
    return m


def test_embedding_and_default_thresholds(model):
    e = model.embed(points_from_payload(pencil(1)))
    assert e.shape == (64,) and abs(np.linalg.norm(e) - 1) < 1e-6
    lo, hi = model.default_config["bounds"]["cosine"]
    assert 0 < lo <= model.default_config["thresholds"]["cosine"] <= hi < 1


def test_tilt_only_pad_data_is_accepted(model):
    s = [[{k: v for k, v in p.items() if k not in ("azimuth", "altitude")} | {"tiltX": 25 + i % 5}
          for i, p in enumerate(st)] for st in pencil(2)]
    assert model.embed(points_from_payload(s)).shape == (64,)


def test_mouse_input_is_rejected(model):
    s = [[{"x": p["x"], "y": p["y"], "t": p["t"], "pressure": 0.5, "tiltX": 0, "tiltY": 0} for p in st]
         for st in pencil(3)]
    with pytest.raises(ValueError, match="Apple Pencil"):
        model.embed(points_from_payload(s))
    assert "Apple Pencil" in PEN_REQUIRED


def test_engine_falls_back_on_a_bad_file(tmp_path):
    (tmp_path / "dynamic_encoder.pt").write_bytes(b"garbage")
    eng = Engine(tmp_path)
    assert eng.dynamic_model.kind == "placeholder"
    assert "load_error" in eng.status()["dynamic"]


def wacom(seed: int) -> list:
    """A pen with pressure but no tilt (e.g. Wacom One CTL-472 in Chrome):
    azimuth 0 and altitude 90 on every point."""
    return [[{k: v for k, v in p.items() if k not in ("tiltX", "tiltY")} | {"azimuth": 0.0, "altitude": 90.0}
             for p in st] for st in pencil(seed)]


def test_no_tilt_pen_needs_development_mode(model, monkeypatch):
    from app import config

    pts = points_from_payload(wacom(4))
    monkeypatch.setattr(config, "DEV_PEN_DEVICES", False)
    with pytest.raises(ValueError, match="Apple Pencil"):
        model.embed(pts)
    monkeypatch.setattr(config, "DEV_PEN_DEVICES", True)
    e = model.embed(pts)
    assert e.shape == (64,) and abs(np.linalg.norm(e) - 1) < 1e-6
    assert model.capture_device(pts) == "development"
    assert model.capture_device(points_from_payload(pencil(4))) == "standard"
    # The missing angle features are neutral (training average), not a fixed angle.
    x, n = model.features(pts)
    for name in ("azimuth_sin", "azimuth_cos", "altitude"):
        if name in model.spec.names:
            assert not x[:n, model.spec.names.index(name)].any()
