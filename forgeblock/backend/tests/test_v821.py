"""v8.21: optional printed-text removal on the questioned static signature only."""
import io
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.ml import text_removal as tr
from app.ml.capture import _ink, standardize
from test_api import _client_with_refs

REAL_WEIGHTS = Path(__file__).resolve().parents[1] / "weights"   # tests use an empty WEIGHTS_DIR
needs_model = pytest.mark.skipif(not (REAL_WEIGHTS / tr.MODEL_FILE).exists(), reason="no text_remover.keras")


@pytest.fixture
def real_weights(monkeypatch):
    monkeypatch.setattr(tr, "WEIGHTS_DIR", REAL_WEIGHTS)
    monkeypatch.setattr(tr, "TEXT_REMOVAL", True)
    monkeypatch.setattr(tr, "_state", {})
    tr._cache.clear()
    yield
    tr._state.clear()


def _signature(h=300, w=700):
    img = np.full((h, w, 3), 245, np.uint8)
    pts = np.array([[60, 200], [140, 90], [210, 230], [300, 80], [380, 210], [470, 110], [560, 190], [640, 140]])
    cv2.polylines(img, [pts.reshape(-1, 1, 2)], False, (25, 25, 25), 3, cv2.LINE_AA)
    cv2.ellipse(img, (250, 160), (70, 40), 15, 0, 300, (25, 25, 25), 3, cv2.LINE_AA)
    return img


def _with_text(img):
    img = img.copy()
    cv2.putText(img, "RECEIVED  Nov 12 2026", (40, 285), cv2.FONT_HERSHEY_DUPLEX, 1.1, (20, 20, 20), 2, cv2.LINE_AA)
    cv2.putText(img, "Signature over printed name", (40, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 20), 2, cv2.LINE_AA)
    return img


def _ink_px(img):
    return int((_ink(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)) > 0).sum())


@needs_model
def test_clean_signature_gets_todays_treatment(real_weights):
    img = _signature()
    out, info = tr.clean_questioned(img)
    assert info["available"] and not info["removed"]
    assert np.array_equal(out, standardize(img))


@needs_model
def test_printed_text_is_removed(real_weights):
    img = _with_text(_signature())
    out, info = tr.clean_questioned(img)
    assert info["removed"] and info["printed_share"] >= 0.10
    assert _ink_px(out) < 0.85 * _ink_px(img)
    sig = _ink(cv2.cvtColor(_signature(), cv2.COLOR_BGR2GRAY)) > 0      # the signature strokes survive
    kept = (_ink(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)) > 0) & sig
    assert kept.sum() > 0.8 * sig.sum()


def test_unavailable_without_weights(monkeypatch, tmp_path):
    monkeypatch.setattr(tr, "WEIGHTS_DIR", tmp_path)
    monkeypatch.setattr(tr, "_state", {})
    tr._cache.clear()
    img = _with_text(_signature())
    out, info = tr.clean_questioned(img)
    assert info == {"requested": True, "available": False, "removed": False}
    assert np.array_equal(out, standardize(img))
    tr._state.clear()


def _png(img):
    return io.BytesIO(cv2.imencode(".png", img)[1].tobytes())


def test_screen_option_recorded_and_original_kept(client, examiner, monkeypatch):
    cid = _client_with_refs(client, examiner, name="Text Removal", n=8)
    img = _with_text(_signature())
    plain = np.full_like(img, 245)
    cv2.polylines(plain, [np.array([[60, 200], [300, 80], [640, 140]]).reshape(-1, 1, 2)], False, (25, 25, 25), 3)

    # Fake remover so this API test does not depend on the model file.
    def fake(raw):
        return standardize(plain), {"requested": True, "available": True, "removed": True, "printed_share": 0.3}
    monkeypatch.setattr(tr, "clean_questioned", fake)
    monkeypatch.setattr(tr, "available", lambda: True)
    assert client.get("/api/static/text-removal", headers=examiner).json() == {"available": True}

    r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid, "remove_text": "true"},
                    files={"file": ("q.png", _png(img), "image/png")})
    assert r.status_code == 200, r.text
    t = r.json()["analysis"]["text_removal"]
    assert t["removed"] and t["original_path"]
    o = client.get(f"/api/verifications/{r.json()['id']}/original-image", headers=examiner)
    assert o.status_code == 200 and o.content[:4] == b"\x89PNG"

    # Without the option nothing changes and there is no original.
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                    files={"file": ("q.png", _png(img), "image/png")})
    assert r.status_code == 200 and r.json()["analysis"]["text_removal"] is None
    assert client.get(f"/api/verifications/{r.json()['id']}/original-image", headers=examiner).status_code == 404
