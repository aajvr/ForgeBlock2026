"""Dynamic enrollment hygiene: single-signature checks (ml/quality.py) and
consistency checks against the client's other references
(ml/dynamic_ref_checks.py). Advice only: screening results never change.
Run from backend/:  pytest -q"""
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.ml.dynamic_features import points_from_payload
from app.ml.dynamic_model import load_dynamic_model, mode_key, pen_channels_present
from app.ml.dynamic_ref_checks import (REASON_LONGER, REASON_LOOKS, REASON_STROKES, flag_references,
                                       pen_mix_notice)
from app.ml.quality import dynamic_quality

from conftest import login

WEIGHTS = Path(__file__).resolve().parents[1] / "weights"
PAUSE = "There was a long pause while signing"


def sig(gap_ms: float = 0.0, pressure=None, n: int = 120, step_ms: float = 10.0, x0: float = 40.0) -> list:
    """One stroke of a wavy signature; a pause of gap_ms in the middle."""
    stroke, t = [], 0.0
    for i in range(n):
        t += step_ms + (gap_ms if i == n // 2 else 0.0)
        p = {"x": x0 + 2.5 * i, "y": 150 + 40 * np.sin(i / 8), "t": t,
             "pressure": (0.4 + 0.2 * np.sin(i / 9)) if pressure is None else pressure}
        stroke.append(p)
    return [stroke]


# ------------------------------------------------- A: single signature ---

def test_long_pause_over_8s_is_unusable():
    q = dynamic_quality(sig(gap_ms=10_000))
    assert not q["usable"]
    assert any(i.startswith(PAUSE) for i in q["issues"])


def test_pause_of_4s_is_usable_with_issue():
    q = dynamic_quality(sig(gap_ms=4_000))
    assert q["usable"]
    assert any(i.startswith(PAUSE) for i in q["issues"])
    assert q["score"] == 75.0


def test_normal_signature_has_no_issues():
    q = dynamic_quality(sig())
    assert q["usable"] and q["issues"] == [] and q["score"] == 100.0


def test_very_long_signature():
    # 1500 points 11 ms apart: 16.5 s with no single long pause.
    q = dynamic_quality(sig(n=1500, step_ms=11))
    assert "The signature took unusually long." in q["issues"]
    assert not any(i.startswith(PAUSE) for i in q["issues"])


def test_constant_pressure_is_no_pressure_and_matches_pen_data():
    strokes = sig(pressure=0.12)
    q = dynamic_quality(strokes)
    assert "No pen pressure was recorded (mouse or finger input)." in q["issues"]
    pts = points_from_payload(strokes)
    assert pen_channels_present(pts)[1] is False
    # Varying pressure: present for both.
    assert pen_channels_present(points_from_payload(sig()))[1] is True
    # Same answer as the model's "Limited pen data" when the trained model is here.
    if (WEIGHTS / "dynamic_encoder.pt").exists():
        model = load_dynamic_model(WEIGHTS)
        if getattr(model, "needs_pressure", False):
            assert "pressure" in model.missing_channels(pts)
            assert "pressure" not in model.missing_channels(points_from_payload(sig()))


def test_stray_tap_far_away_is_flagged_but_dot_is_not():
    strokes = sig()
    far = [{"x": 900.0, "y": 600.0, "t": strokes[0][-1]["t"] + 200, "pressure": 0.3},
           {"x": 901.0, "y": 600.0, "t": strokes[0][-1]["t"] + 210, "pressure": 0.31}]
    q = dynamic_quality(strokes + [far])
    assert "A stray mark was recorded (a tap or palm touch)." in q["issues"] and q["usable"]
    # A dot just above the signature (like on an i) is fine.
    dot = [{"x": 120.0, "y": 100.0, "t": strokes[0][-1]["t"] + 200, "pressure": 0.3},
           {"x": 121.0, "y": 100.0, "t": strokes[0][-1]["t"] + 210, "pressure": 0.31}]
    assert not any("stray" in i for i in dynamic_quality(strokes + [dot])["issues"])


# --------------------------------------------- B: against other refs ---

def _ref(pid, emb, duration=2.0, strokes=1, missing=()):
    e = np.asarray(emb, dtype=float)
    e = e / np.linalg.norm(e)
    mode = mode_key(missing)
    return SimpleNamespace(id=pid, modality="dynamic", embedding=e.tolist(), capture_device=None,
                           features={"duration": duration, "strokes": strokes, "path_length": 10.0,
                                     "_pen": {"missing": list(missing), "modes": {mode: e.tolist()}}})


def _normal_refs(n, rng):
    base = rng.normal(size=64)
    return [_ref(i + 1, base + rng.normal(scale=0.08, size=64), duration=2.0 + rng.normal(0, 0.15))
            for i in range(n)]


def test_only_the_bad_reference_is_flagged_with_all_three_reasons():
    rng = np.random.default_rng(52)
    refs = _normal_refs(9, rng)
    bad = _ref(100, rng.normal(size=64), duration=28.0, strokes=3)
    flags = flag_references(refs + [bad])
    assert set(flags) == {100}
    assert set(flags[100]) == {REASON_LONGER, REASON_STROKES, REASON_LOOKS}


def test_two_strokes_is_not_two_apart():
    """The CL-0052 ref #1 had 2 strokes vs 1: under the stroke rule (2 or more
    apart), but duration and looks still flag it."""
    rng = np.random.default_rng(7)
    bad = _ref(100, rng.normal(size=64), duration=28.0, strokes=2)
    flags = flag_references(_normal_refs(9, rng) + [bad])
    assert set(flags) == {100} and REASON_STROKES not in flags[100]


def test_fewer_than_four_references_flag_nothing():
    rng = np.random.default_rng(3)
    bad = _ref(100, rng.normal(size=64), duration=28.0, strokes=4)
    assert flag_references(_normal_refs(2, rng) + [bad]) == {}


def test_pen_mix_notice():
    rng = np.random.default_rng(4)
    refs = _normal_refs(3, rng)
    assert pen_mix_notice(refs) is None
    limited = _ref(50, rng.normal(size=64), missing=("tilt", "pressure"))
    msg = pen_mix_notice(refs + [limited])
    assert msg and "(3)" in msg and "(1)" in msg


# ------------------------------------------------------ C: endpoints ---

def _keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys(v)


def test_staff_see_check_reasons_clients_do_not(client, admin, examiner):
    r = client.post("/api/clients", headers=examiner,
                    json={"full_name": "Ref Check Client", "email": "refcheck-client@example.com"})
    assert r.status_code == 200, r.text
    cl = r.json()
    r = client.post(f"/api/clients/{cl['id']}/dynamic/enroll", headers=examiner,
                    json={"samples": [sig(x0=40 + k) for k in range(5)]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["accepted"]) == 5 and "flags" in body and "pen_mix_notice" in body

    card = client.get(f"/api/clients/{cl['id']}", headers=examiner).json()
    assert card["dynamic_references"] and all("check_reasons" in p for p in card["dynamic_references"])
    assert "dynamic_pen_mix_notice" in card

    acc = cl["new_account"]
    h = login(client, acc["email"], acc["temporary_password"])
    client.post("/api/auth/change-password", headers=h,
                json={"current_password": acc["temporary_password"], "new_password": "client12345"})
    client.post("/api/auth/research-use/accept", headers=h)
    me = client.get("/api/me/client", headers=h)
    assert me.status_code == 200, me.text
    keys = set(_keys(me.json()))
    assert "check_reasons" not in keys and "dynamic_pen_mix_notice" not in keys and "flags" not in keys


@pytest.mark.parametrize("gap", [0, 4_000])
def test_enroll_still_accepts_usable(client, examiner, gap):
    r = client.post("/api/clients", headers=examiner, json={"full_name": f"Gap {gap}"})
    cid = r.json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner, json={"samples": [sig(gap_ms=gap)]})
    assert r.status_code == 200 and len(r.json()["accepted"]) == 1


def test_enroll_rejects_long_pause(client, examiner):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Long pause"}).json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner, json={"samples": [sig(gap_ms=10_000)]})
    assert r.status_code == 200 and not r.json()["accepted"] and r.json()["rejected"]
