"""v8.10: per-client classifier for static screening (app/ml/client_classifier.py)."""
import numpy as np
from test_api import _client_with_refs, signature_png

from app.ml import client_classifier as cc
from app.database import SessionLocal
from app.ml.engine import get_engine
from app.services import set_setting


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


def _background_value(n_people: int, dim: int, fingerprint, seed: int = 1) -> dict:
    """A v8.25 fixed background set as stored by app.import_static_background."""
    rng = np.random.default_rng(seed)
    people = []
    for i in range(n_people):
        centre = _unit(rng.normal(size=dim))
        people.append({"code": f"P{i:02d}", "embeddings": _unit(centre + 0.15 * rng.normal(size=(10, dim))).tolist()})
    return {"fingerprint": fingerprint, "built": f"test-{n_people}", "people": people}


def test_shipped_calibration_has_classifier_entry():
    import json
    from pathlib import Path

    c = json.loads((Path(__file__).parents[1] / "weights" / "calibration.json").read_text())
    entry = c["static_client_classifier"]["f5f7cf01b8c40d87"]  # the shipped v8.12 static model
    assert entry["a"] > 0 and entry["band"] == [0.35, 0.65]


def test_screening_uses_fixed_background_not_live_clients(client, examiner, monkeypatch):
    """v8.25: the check uses the stored fixed background set, never other clients."""

    engine = get_engine()
    cfg = engine.static_cfg  # tests run on the placeholder model, so give it the entry
    monkeypatch.setitem(cfg, "client_classifier", {"a": 6.3925, "b": -5.4503, "band": [0.35, 0.65]})
    cid = _client_with_refs(client, examiner)
    screen = lambda: client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                                 files={"file": ("q.png", signature_png(1, jitter=0.65), "image/png")}).json()
    dim = len(engine.static_embedding(np.full((60, 120, 3), 255, np.uint8)))

    def store(value):
        with SessionLocal() as db:
            set_setting(db, cc.BACKGROUND_SETTING, value)

    try:
        store({})  # no background stored: distance only, whatever clients exist
        info = screen()["analysis"]["client_classifier"]
        assert info["used"] is False and info["source"] == "fixed" and "reason" in info

        store(_background_value(cc.MIN_BACKGROUND_CLIENTS - 1, dim, engine.static_fingerprint))
        assert screen()["analysis"]["client_classifier"]["used"] is False  # too small

        store(_background_value(12, dim, "another-model"))
        info = screen()["analysis"]["client_classifier"]
        assert info["used"] is False and "another static model" in info["reason"]

        store(_background_value(12, dim, engine.static_fingerprint))
        r = screen()
        info = r["analysis"]["client_classifier"]
        assert info["used"] is True and info["background_clients"] == 12 and "reason" not in info
        assert r["screening_result"] in ("consistent", "inconclusive", "inconsistent")
        assert 0 <= r["confidence_score"] <= 99
        assert r["integrity"]["valid"]
    finally:
        store({})


def test_background_ignores_short_or_mismatched_people():
    dim = 8
    v = _background_value(12, dim, "fp")
    v["people"][0]["embeddings"] = v["people"][0]["embeddings"][:5]      # too few references
    v["people"][1]["embeddings"] = [[0.0] * (dim + 1)] * 10               # wrong embedding size
    arr, info = cc.background_from_setting(v, "fp", dim)
    assert info["background_clients"] == 10 and arr.shape == (100, dim)
    v["built"] = "test-11"
    v["people"][2]["embeddings"] = []
    arr, info = cc.background_from_setting(v, "fp", dim)
    assert arr is None and info["background_clients"] == 9 and info["reason"] == "background set too small"
    assert cc.background_from_setting(v, "other", dim)[0] is None
    assert cc.background_from_setting(None, "fp", dim)[0] is None
