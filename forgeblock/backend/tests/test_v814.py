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
    # v8.26: how the number was reached, step by step, ending with the result rule
    assert ex["passed"] == sum(r["votes"].values()) and f"{p}%" in ex["how"]
    assert ex["steps"][0]["title"].startswith("1.") and ex["steps"][-1]["title"].endswith("Result")
    assert f"{round(r['confidence_score'])}%" in ex["steps"][-1]["text"]


def test_explanation_names_the_per_client_check():
    """All three measures pass, but the per-client check lowers the chance: the
    explanation must say so, not just 'passed by a little'."""
    from types import SimpleNamespace as N

    from app.routers import verification as v
    cal = {"a": 1.3581, "b": -1.3802, "band": [0.35, 0.65]}
    v_engine = v.get_engine
    v.get_engine = lambda: N(static_cfg={"calibration": cal})
    try:
        l = N(modality="static", classification="forged", confidence_score=73.0, screening_result="inconsistent",
              metrics={"cosine": 0.8, "euclidean": 0.5, "manhattan": 7},
              thresholds={"cosine": 0.7, "euclidean": 0.6, "manhattan": 8},
              analysis={"client_classifier": {"used": True, "score": 0.31, "p_distance_only": 0.58,
                                              "background_clients": 12}})
        ex = v.explain_result(l)
    finally:
        v.get_engine = v_engine
    assert ex["all_pass"] and ex["lowered_by_client_check"] and ex["p_distance_only"] == 58 and ex["p_genuine"] == 27
    assert "from 58% to 27%" in ex["why"] and "12 other people" in ex["how"]
    assert [s["title"][3:] for s in ex["steps"]] == ["Scores against the thresholds", "How far past the thresholds",
                                                      "Per-client check", "Result"]


def test_check_that_agrees_is_not_called_a_change():
    """0 of 3 pass, 1% from the margin, 2% from the per-client check: both
    Inconsistent, so the check 'agreed'; it did not 'raise' anything."""
    from types import SimpleNamespace as N

    from app.routers import verification as v
    v_engine = v.get_engine
    v.get_engine = lambda: N(static_cfg={"calibration": {"a": 1.3581, "b": -1.3802, "band": [0.35, 0.65]}})
    try:
        l = N(modality="static", classification="forged", confidence_score=98.0, screening_result="inconsistent",
              metrics={"cosine": 0.2, "euclidean": 1.2, "manhattan": 16},
              thresholds={"cosine": 0.7, "euclidean": 0.6, "manhattan": 8},
              analysis={"client_classifier": {"used": True, "score": -0.4, "p_distance_only": 0.006,
                                              "background_clients": 12}})
        ex = v.explain_result(l)
    finally:
        v.get_engine = v_engine
    assert "agreed (2%)" in ex["how"] and "short of the thresholds" in ex["how"]
    assert "moved" not in ex["how"] and "rais" not in ex["how"] and not ex["lowered_by_client_check"]
    assert ex["steps"][1]["title"] == "2. How far short of the thresholds"


def test_no_explanation_without_calibration(client, examiner, monkeypatch):
    monkeypatch.setitem(get_engine().static_cfg, "calibration", None)
    cid = _client_with_refs(client, examiner, name="No calibration")
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(1, jitter=0.65), "image/png")}).json()
    assert r["explain"] is None
