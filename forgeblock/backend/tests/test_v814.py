"""v8.14: plain-language explanation of the result (staff only)."""
from test_api import _client_with_refs, signature_png

from app.ml.engine import get_engine


def test_result_explains_itself(client, examiner, monkeypatch):
    cfg = get_engine().static_cfg  # tests run on the placeholder model: give it a calibration
    monkeypatch.setitem(cfg, "calibration", {"a": 1.9663, "b": -2.4516, "band": [0.35, 0.65]})
    cid = _client_with_refs(client, examiner)
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(1, jitter=0.65), "image/png")}).json()
    ex = r["explain"]
    assert ex["band"] == [35, 65] and 1 <= ex["p_genuine"] <= 99
    p = ex["p_genuine"]
    expected = "consistent" if p >= 65 else ("inconsistent" if p <= 35 else "inconclusive")
    assert r["screening_result"] == expected or abs(p - 65) <= 1 or abs(p - 35) <= 1  # rounding at the edges
    assert f"{p}%" in ex["why"]
    assert ex["all_pass"] == all(r["votes"].values())


def test_no_explanation_without_calibration(client, examiner, monkeypatch):
    monkeypatch.setitem(get_engine().static_cfg, "calibration", None)
    cid = _client_with_refs(client, examiner, name="No calibration")
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(1, jitter=0.65), "image/png")}).json()
    assert r["explain"] is None
