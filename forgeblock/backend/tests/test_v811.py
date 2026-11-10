"""v8.11: dynamic signatures without pen pressure and/or tilt are accepted,
labelled "Limited pen data" and compared on the pen data both sides have.
Run from backend/:  pytest -q"""
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.ml import engine as engine_mod
from app.ml.dynamic_features import points_from_payload
from app.ml.dynamic_model import BASIC_FILENAME, missing_from_key, mode_key
from app.ml.engine import Engine
from app.routers import pen_data

from test_dynamic_svc import pencil, wacom

WEIGHTS = Path(__file__).resolve().parents[1] / "weights"
pytestmark = pytest.mark.skipif(not (WEIGHTS / "dynamic_encoder.pt").exists(), reason="no trained dynamic model")


def finger(seed: int) -> list:
    return [[{"x": p["x"], "y": p["y"], "t": p["t"], "pressure": 0.5, "tiltX": 0, "tiltY": 0} for p in st]
            for st in pencil(seed)]


def no_pressure(seed: int) -> list:
    return [[{k: v for k, v in p.items() if k != "pressure"} for p in st] for st in pencil(seed)]


@pytest.fixture()
def real_engine(tmp_path, monkeypatch):
    shutil.copy(WEIGHTS / "dynamic_encoder.pt", tmp_path / "dynamic_encoder.pt")
    eng = Engine(tmp_path)
    monkeypatch.setattr(engine_mod, "_engine", eng)
    return eng


def test_mode_names():
    assert mode_key(()) == "full" and mode_key({"tilt"}) == "no_tilt"
    assert mode_key({"pressure"}) == "no_pressure" and mode_key({"tilt", "pressure"}) == "basic"
    for k in ("full", "no_tilt", "no_pressure", "basic"):
        assert mode_key(missing_from_key(k)) == k


def test_missing_channels_and_modes(real_engine):
    full, modes = real_engine.dynamic_mode_embeddings(points_from_payload(pencil(1)))
    assert full == frozenset() and set(modes) == {"full", "no_tilt", "no_pressure", "basic"}
    miss, modes = real_engine.dynamic_mode_embeddings(points_from_payload(wacom(1)))
    assert miss == {"tilt"} and set(modes) == {"no_tilt", "basic"}
    miss, modes = real_engine.dynamic_mode_embeddings(points_from_payload(no_pressure(1)))
    assert miss == {"pressure"} and set(modes) == {"no_pressure", "basic"}
    miss, modes = real_engine.dynamic_mode_embeddings(points_from_payload(finger(1)))
    assert miss == {"tilt", "pressure"} and set(modes) == {"basic"}


def test_left_out_channel_equals_missing_channel(real_engine):
    """A Pencil signature compared without tilt gives the same embedding as
    the same signature recorded without tilt."""
    a = real_engine.dynamic_mode_embedding(points_from_payload(pencil(2)), "basic")
    b = real_engine.dynamic_mode_embedding(points_from_payload(finger(2)), "basic")
    assert float(a @ b) > 0.999


def _profile(pid, strokes, eng):
    pen = pen_data.enroll_payload(points_from_payload(strokes))
    return SimpleNamespace(id=pid, embedding=pen["embedding"], capture_device=pen["capture_device"],
                           features={"_pen": pen["pen"]}, sample_path="missing/none.json")


def test_choose_mode(real_engine):
    pencils = [_profile(i, pencil(10 + i), real_engine) for i in range(6)]
    fingers = [_profile(10 + i, finger(20 + i), real_engine) for i in range(2)]
    # Pencil query, 6 Pencil references: full comparison, finger refs not used.
    mode, used = pen_data.choose_mode(frozenset(), pencils + fingers)
    assert mode == "full" and len(used) == 6
    # Pencil query, only 2 Pencil references: every reference, basic mode.
    mode, used = pen_data.choose_mode(frozenset(), pencils[:2] + fingers)
    assert mode == "basic" and len(used) == 4
    # Finger query: basic mode with all references.
    mode, used = pen_data.choose_mode(frozenset({"tilt", "pressure"}), pencils + fingers)
    assert mode == "basic" and len(used) == 8
    # No-pressure query: references with pressure can still be used without it.
    mode, used = pen_data.choose_mode(frozenset({"pressure"}), pencils)
    assert mode == "no_pressure" and len(used) == 6


def test_compare_set_and_note(real_engine):
    refs = [_profile(i, pencil(30 + i), real_engine) for i in range(5)]
    test, pairs, mode, missing, cfg = pen_data.compare_set(points_from_payload(finger(31)), refs)
    assert mode == "basic" and len(pairs) == 5 and missing == {"tilt", "pressure"}
    note = pen_data.screening_note(mode, missing, pairs)
    assert note["label"] == "Limited pen data" and "no pen pressure or tilt" in note["message"]
    test, pairs, mode, missing, cfg = pen_data.compare_set(points_from_payload(pencil(31)), refs)
    assert mode == "full" and pen_data.screening_note(mode, missing, pairs) is None


def test_old_references_without_stored_modes(real_engine):
    """References from before v8.11 (no features["_pen"]) still work in full
    mode; in other modes they need their strokes (or a re-embed)."""
    old = SimpleNamespace(id=1, embedding=real_engine.dynamic_embedding(points_from_payload(pencil(40))).tolist(),
                          capture_device=None, features={"duration": 1.0}, sample_path="missing/none.json")
    assert pen_data.ref_embedding(old, "full") is not None
    assert pen_data.ref_embedding(old, "basic") is None


def test_public_features_hide_embeddings():
    assert pen_data.public_features({"duration": 2.0, "_pen": {"modes": {}}}) == {"duration": 2.0}


def test_basic_model_is_used_without_tilt(tmp_path, monkeypatch):
    basic = WEIGHTS / BASIC_FILENAME
    if not basic.exists():
        pytest.skip(f"no {BASIC_FILENAME} (the notebook's OWN_E3 export) in backend/weights")
    shutil.copy(WEIGHTS / "dynamic_encoder.pt", tmp_path / "dynamic_encoder.pt")
    shutil.copy(basic, tmp_path / BASIC_FILENAME)
    eng = Engine(tmp_path)
    assert eng.dynamic_basic_model is not None
    assert eng.dynamic_cfg["model_version"].endswith("+basic") and len(eng.dynamic_cfg["model_version"]) <= 60
    assert eng.dynamic_cfg_for("basic") is eng.dynamic_basic_cfg
    assert eng.dynamic_cfg_for("no_pressure") is eng.dynamic_cfg
    e = eng.dynamic_mode_embedding(points_from_payload(finger(5)), "basic")
    assert e.shape[0] > 0 and abs(np.linalg.norm(e) - 1) < 1e-6


def test_a_tilt_model_is_refused_as_basic_model(tmp_path):
    shutil.copy(WEIGHTS / "dynamic_encoder.pt", tmp_path / "dynamic_encoder.pt")
    shutil.copy(WEIGHTS / "dynamic_encoder.pt", tmp_path / BASIC_FILENAME)
    assert Engine(tmp_path).dynamic_basic_model is None


def test_api_enroll_and_screen_limited(client, examiner, real_engine):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Limited Pen"}).json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [pencil(50 + i) for i in range(5)] + [finger(60)]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["accepted"]) == 6 and not body["rejected"]
    assert body["accepted"][-1]["capture_device"] == "limited"
    assert "no pen pressure or tilt" in body["accepted"][-1]["notice"]
    assert body["limited_notice"] and "Limited pen data" in body["limited_notice"]
    assert body["accepted"][0]["notice"] is None
    # Profile details never expose the stored embeddings.
    pid = body["accepted"][-1]["id"]
    d = client.get(f"/api/references/{pid}/strokes", headers=examiner)
    assert d.status_code == 200, d.text
    assert "_pen" not in d.json()["features"] and d.json()["pen_missing"] == ["pressure", "tilt"]
    # Finger screening: accepted, labelled, every reference used.
    r = client.post("/api/screen/dynamic", headers=examiner, json={"test": finger(51), "client_id": cid})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["capture_device"] == "limited"
    assert res["analysis"]["pen_data"]["label"] == "Limited pen data"
    assert res["reference_count"] == 6
    # Pencil screening with 5 Pencil references: full comparison, no label.
    r = client.post("/api/screen/dynamic", headers=examiner, json={"test": pencil(52), "client_id": cid})
    res = r.json()
    assert r.status_code == 200 and res["capture_device"] is None and res["analysis"]["pen_data"] is None
    assert res["reference_count"] == 5
