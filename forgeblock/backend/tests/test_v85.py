"""v8.5: calibrated (Platt) confidence."""
import json
import shutil

import numpy as np

from app.ml import decision as dec
from app.ml.engine import Engine, _load_calibration
from app.ml.screening import screening_result
from pathlib import Path

SHIPPED = Path(__file__).resolve().parents[1] / "weights"

CAL = {"a": 1.3, "b": 1.35}


def test_probability_is_logistic():
    assert abs(dec.calibrated_probability(0.0, {"a": 1, "b": 0}) - 0.5) < 1e-9
    assert dec.calibrated_probability(5, CAL) > 0.99
    assert dec.calibrated_probability(-5, CAL) < 0.01


def test_dynamic_calibrated_decision_and_bands():
    mean_refs = (0.95, 0.02)
    typical = {"cosine": mean_refs}
    tau = 0.92
    strong = dec.dynamic_decision({"cosine": 0.97, "euclidean": 0.2}, tau, "adaptive", typical, CAL)
    weak = dec.dynamic_decision({"cosine": 0.905, "euclidean": 0.4}, tau, "adaptive", typical, CAL)
    bad = dec.dynamic_decision({"cosine": 0.70, "euclidean": 0.8}, tau, "adaptive", typical, CAL)
    assert strong.p_genuine > 0.9 and screening_result(strong, 20) == "consistent"
    assert 0.35 < weak.p_genuine < 0.65 and screening_result(weak, 20) == "inconclusive"
    assert bad.p_genuine < 0.05 and screening_result(bad, 20) == "inconsistent"
    assert bad.classification == "forged" and abs(bad.confidence - min(99, 100 * (1 - bad.p_genuine))) < 1e-9


def test_uncalibrated_keeps_v82_behaviour():
    d = dec.dynamic_decision({"cosine": 0.921, "euclidean": 0.39}, 0.92, "adaptive", {"cosine": (0.95, 0.02)})
    assert d.p_genuine is None
    assert screening_result(d, 20) == "inconclusive"  # low confidence -> Inconclusive, as in v8.2


def test_static_calibrated_uses_mean_z():
    refs = [np.eye(8)[0] + 0.05 * np.eye(8)[i] for i in range(1, 7)]
    refs = [r / np.linalg.norm(r) for r in refs]
    cfg = {"thresholds": {"cosine": 0.9, "euclidean": 0.4, "manhattan": 5.0},
           "bounds": {"cosine": [0.5, 0.99], "euclidean": [0.01, 1.0], "manhattan": [0.01, 9.0]},
           "calibration": CAL}
    d = dec.screen_static_embedding(refs[0], refs[1:], cfg, 5)
    assert d.p_genuine is not None and d.classification == "genuine"


def test_calibration_only_for_matching_model(tmp_path):
    p = tmp_path / "calibration.json"
    p.write_text(json.dumps({"dynamic": {"thr:0.500000": CAL}}))
    assert _load_calibration(p, "dynamic", "thr:0.500000")["a"] == 1.3
    assert _load_calibration(p, "dynamic", "thr:0.123456") is None
    assert _load_calibration(p, "static", "abc") is None
    assert _load_calibration(tmp_path / "missing.json", "dynamic", "thr:0.500000") is None


def test_engine_reads_shipped_calibration(tmp_path):
    for f in SHIPPED.iterdir():
        if f.is_file():
            shutil.copy(f, tmp_path / f.name)
    e = Engine(tmp_path)
    if getattr(e.dynamic_model, "checkpoint_thresholds", None):
        assert e.dynamic_cfg["calibration"] is not None, e.dynamic_fingerprint
    (tmp_path / "calibration.json").unlink()
    assert Engine(tmp_path).dynamic_cfg["calibration"] is None


def test_per_module_band():
    cal = {**CAL, "band": [0.35, 0.65]}
    d = dec.dynamic_decision({"cosine": 0.93, "euclidean": 0.3}, 0.92, "adaptive", {"cosine": (0.95, 0.02)}, cal)
    assert d.band == (0.35, 0.65)
    expected = "consistent" if d.p_genuine >= 0.65 else ("inconsistent" if d.p_genuine <= 0.35 else "inconclusive")
    assert screening_result(d, 20) == expected
