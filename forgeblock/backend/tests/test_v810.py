"""v8.10: per-client classifier for static screening (app/ml/client_classifier.py)."""
import numpy as np
from test_api import _client_with_refs, signature_png

from app.database import SessionLocal
from app.ml import client_classifier as cc
from app.ml.engine import get_engine
from app.models import Client, SignatureProfile


def _unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def test_classifier_separates_client_from_others():
    rng = np.random.default_rng(0)
    centre = _unit(rng.normal(size=256))
    pos = _unit(centre + 0.15 * rng.normal(size=(10, 256)))
    others = [_unit(rng.normal(size=256)) for _ in range(12)]
    neg = np.concatenate([_unit(c + 0.15 * rng.normal(size=(10, 256))) for c in others])
    score = cc.fit(pos, neg)
    own = score(_unit(centre + 0.15 * rng.normal(size=(5, 256))))
    other = score(_unit(others[0] + 0.15 * rng.normal(size=(5, 256))))
    assert own.min() > other.max()
    assert abs(float(np.mean(own)) - 1) < 0.5 and abs(float(np.mean(other))) < 0.5  # normalised scale
    cal = {"a": 6.3925, "b": -5.4503}
    assert cc.probability(1.0, cal) > 0.65 and cc.probability(0.0, cal) < 0.35


def _add_background(n_clients: int, version: str, dim: int, start: int = 0):
    rng = np.random.default_rng(1 + start)
    with SessionLocal() as db:
        for i in range(start, start + n_clients):
            c = Client(client_code=f"BG-{i:03d}", full_name=f"Background {i}")
            db.add(c)
            db.flush()
            centre = _unit(rng.normal(size=dim))
            for e in _unit(centre + 0.15 * rng.normal(size=(10, dim))):
                db.add(SignatureProfile(client_id=c.id, modality="static", sample_path="none.png",
                                        embedding=e.tolist(), model_version=version))
        db.commit()


def test_shipped_calibration_has_classifier_entry():
    import json
    from pathlib import Path

    c = json.loads((Path(__file__).parents[1] / "weights" / "calibration.json").read_text())
    entry = c["static_client_classifier"]["f5f7cf01b8c40d87"]  # the shipped v8.12 static model
    assert entry["a"] > 0 and entry["band"] == [0.35, 0.65]


def test_screening_uses_classifier_only_with_enough_clients(client, examiner, monkeypatch):
    cfg = get_engine().static_cfg  # tests run on the placeholder model, so give it the entry
    monkeypatch.setitem(cfg, "client_classifier", {"a": 6.3925, "b": -5.4503, "band": [0.35, 0.65]})
    cid = _client_with_refs(client, examiner)
    screen = lambda: client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                                 files={"file": ("q.png", signature_png(1, jitter=0.65), "image/png")}).json()

    r = screen()
    info = r["analysis"]["client_classifier"]
    have = info["background_clients"]  # other tests may already have made clients with references
    assert info["used"] is (have >= cc.MIN_BACKGROUND_CLIENTS)

    dim = len(get_engine().static_embedding(np.full((60, 120, 3), 255, np.uint8)))
    missing = cc.MIN_BACKGROUND_CLIENTS - have
    if missing > 1:
        _add_background(missing - 1, cfg["model_version"], dim)
        assert screen()["analysis"]["client_classifier"]["used"] is False  # one short: plain method
    _add_background(max(missing, 1) if missing <= 1 else 1, cfg["model_version"], dim, start=100)
    r = screen()
    info = r["analysis"]["client_classifier"]
    assert info["used"] is True and info["background_clients"] >= cc.MIN_BACKGROUND_CLIENTS
    assert r["screening_result"] in ("consistent", "inconclusive", "inconsistent")
    assert 0 <= r["confidence_score"] <= 99
    assert r["integrity"]["valid"]
