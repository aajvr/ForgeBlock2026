"""Dynamic gate: an entirely different signature should not stay Inconclusive.
Shape check (ml/dynamic_shape.py) and handwriting features can move the
result (ml/screening.dynamic_gate); the model, embeddings, thresholds and
calibration are unchanged.  Run from backend/:  pytest -q"""
from types import SimpleNamespace

import numpy as np

from app.ml.dynamic_shape import shape_check, shape_points
from app.ml.screening import dynamic_gate
from app.routers.verification import _gate_because


def _writer(seed):
    return np.random.default_rng(seed).normal(size=(2, 6))


def sign(w, seed, strokes=1):
    """A wavy synthetic signature for writer w; each seed is a natural variation."""
    r = np.random.default_rng(seed)
    t = np.linspace(0, 1, 200)
    x = t * 3 + sum(w[0, k] * 0.25 * np.sin((k + 1) * 2 * np.pi * t + r.normal(0, 0.09)) for k in range(6))
    y = sum(w[1, k] * 0.3 * np.cos((k + 1) * 2 * np.pi * t + r.normal(0, 0.09)) for k in range(6))
    a, s = np.deg2rad(r.normal(0, 4)), 1 + r.normal(0, 0.08)
    X = (x * np.cos(a) - y * np.sin(a)) * s * 100 + r.normal(0, 1, 200)
    Y = (x * np.sin(a) + y * np.cos(a)) * s * 100
    pts = [{"x": float(X[i]), "y": float(Y[i]), "t": i * 10.0, "pressure": 0.4 + 0.2 * np.sin(i / 9)}
           for i in range(200)]
    k = len(pts) // strokes
    return [pts[i * k:(i + 1) * k] for i in range(strokes)]


def test_genuine_variations_are_not_far():
    w = _writer(1)
    refs = [shape_points(sign(w, 100 + i)) for i in range(9)]
    for i in range(10):
        c = shape_check(shape_points(sign(w, 500 + i)), refs)
        assert c["used"] and not c["far"] and c["ratio"] < 1.8
    # Lifting the pen mid-signature does not change the shape.
    assert not shape_check(shape_points(sign(w, 600, strokes=3)), refs)["far"]


def test_entirely_different_signature_is_far():
    w = _writer(1)
    refs = [shape_points(sign(w, 100 + i)) for i in range(9)]
    c = shape_check(shape_points(sign(_writer(903), 1)), refs)
    assert c["used"] and c["far"] and c["ratio"] >= 2.0


def test_too_few_references_not_used():
    w = _writer(2)
    refs = [shape_points(sign(w, 100 + i)) for i in range(2)]
    assert shape_check(shape_points(sign(_writer(9), 1)), refs)["used"] is False


def test_gate_rules():
    # The CL-0052 case: Inconclusive, leans not genuine, 6 of 7 features outside.
    assert dynamic_gate("inconclusive", False, 6, False) == ("inconsistent", ["features"])
    assert dynamic_gate("inconclusive", False, 1, True) == ("inconsistent", ["shape"])
    # Leaning genuine: stays Inconclusive for the examiner.
    assert dynamic_gate("inconclusive", True, 7, True) == ("inconclusive", [])
    # Consistent with a clear disagreement goes to the examiner, never straight to Inconsistent.
    assert dynamic_gate("consistent", True, 1, True) == ("inconclusive", ["shape"])
    # Not enough evidence: nothing moves. Inconsistent is never changed.
    assert dynamic_gate("inconclusive", False, 4, False) == ("inconclusive", [])
    assert dynamic_gate("inconsistent", False, 7, True) == ("inconsistent", [])


def test_gate_explanation_is_plain():
    log = SimpleNamespace(analysis={
        "features": {"items": [{"mean": 1.0}] * 7},
        "shape": {"ratio": 3.4},
        "dynamic_gate": {"applied": True, "reasons": ["shape", "features"], "features_outside": 6,
                         "result_before_gate": "inconclusive"},
    })
    text = _gate_because(log)
    assert "3.4x" in text and "6 of 7 handwriting features" in text
    assert _gate_because(SimpleNamespace(analysis={"dynamic_gate": {"applied": False}})) is None


def test_screening_records_shape_and_gate(client, examiner):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Shape Gate"}).json()["id"]
    w = _writer(1)
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [sign(w, 100 + i) for i in range(5)]})
    assert r.status_code == 200 and len(r.json()["accepted"]) == 5, r.text
    r = client.post("/api/screen/dynamic", headers=examiner, json={"client_id": cid, "test": sign(_writer(903), 1)})
    assert r.status_code == 200, r.text
    a = r.json()["analysis"]
    assert a["shape"]["used"] and a["shape"]["far"]
    gate = a["dynamic_gate"]
    assert gate["enabled"] and gate["shape_far"]
    if gate["applied"]:
        assert "shape" in gate["reasons"]
    # Never Consistent when the shape is clearly different.
    assert r.json()["screening_result"] != "consistent"


def test_admin_can_switch_the_dynamic_gate_off(client, admin, examiner):
    r = client.put("/api/admin/settings/screening", headers=admin, json={"dynamic_gate": False})
    assert r.status_code == 200 and r.json()["dynamic_gate"] is False
    # Examiners cannot change it.
    assert client.put("/api/admin/settings/screening", headers=examiner, json={"dynamic_gate": True}).status_code == 403
    try:
        cid = client.post("/api/clients", headers=examiner, json={"full_name": "Gate Off"}).json()["id"]
        w = _writer(1)
        client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [sign(w, 100 + i) for i in range(5)]})
        r = client.post("/api/screen/dynamic", headers=examiner, json={"client_id": cid, "test": sign(_writer(903), 1)})
        gate = r.json()["analysis"]["dynamic_gate"]
        assert gate["enabled"] is False and gate["applied"] is False
        assert r.json()["screening_result"] == gate["result_before_gate"]
    finally:
        r = client.put("/api/admin/settings/screening", headers=admin, json={"dynamic_gate": True})
        assert r.json()["dynamic_gate"] is True and r.json()["feature_gate"] is not False
