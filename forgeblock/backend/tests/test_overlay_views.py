"""Overlay views for static screenings (visual aid only): the aligned overlay
and the feature marks."""
import cv2
import numpy as np
import pytest
from conftest import make_user
from test_api import _client_with_refs, signature_png

from app.ml.explain import _ink, _warp, align_ink
from app.ml.features import _ink_offset, static_feature_marks, static_features
from app.ml.preprocessing import ink_mask

MARK_KEYS = {"width", "height", "bbox", "width_height_ratio", "slant", "baseline", "loops", "endpoints",
             "pieces", "stroke_thickness", "ink_density"}


def _img(seed=1, jitter=0.6):
    return cv2.imdecode(np.frombuffer(signature_png(seed, jitter), np.uint8), cv2.IMREAD_COLOR)


@pytest.fixture(scope="module")
def screening(client, examiner, admin):
    cid = _client_with_refs(client, examiner, "Overlay Views")
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(1, 0.9), "image/png")})
    assert r.status_code == 200, r.text
    return {"cid": cid, "id": r.json()["id"]}


def test_overlay_aligned_and_raw(client, examiner, screening):
    for aligned in ("1", "0"):
        r = client.get(f"/api/verifications/{screening['id']}/overlay?aligned={aligned}", headers=examiner)
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        assert r.headers["cache-control"] == "no-store, private" and r.headers["content-disposition"] == "inline"
    assert client.get(f"/api/verifications/{screening['id']}/overlay?aligned=2", headers=examiner).status_code == 422


def test_feature_marks(client, examiner, screening):
    r = client.get(f"/api/verifications/{screening['id']}/feature-marks", headers=examiner)
    assert r.status_code == 200, r.text
    body = r.json()
    for side in ("questioned", "reference"):
        m = body[side]
        assert MARK_KEYS <= set(m)
        x, y, w, h = m["bbox"]
        assert 0 <= x and 0 <= y and x + w <= m["width"] and y + h <= m["height"]
        assert {"angle_deg", "line"} <= set(m["slant"]) and len(m["slant"]["line"]) == 2
        assert {"line", "tilt_deg"} <= set(m["baseline"]) and len(m["baseline"]["line"]) == 2
        assert all({"cx", "cy", "r"} <= set(lp) for lp in m["loops"])
        assert all(len(p) == 2 for p in m["endpoints"])
    assert isinstance(body["outside"], list)
    assert all({"name", "label"} <= set(o) for o in body["outside"])


def test_overlay_views_need_staff_and_access(client, admin, examiner, examiner2, screening):
    sid = screening["id"]
    paths = [f"/api/verifications/{sid}/overlay", f"/api/verifications/{sid}/feature-marks"]
    for p in paths:
        assert client.get(p).status_code == 401
        # An examiner outside the client's group does not see the record.
        assert client.get(p, headers=examiner2).status_code == 404
        assert client.get(p, headers=admin).status_code == 200
    # A client account, even for their own screening: staff only.
    h = make_user(client, admin, "overlay-client@example.com", role="client", client_id=screening["cid"])
    for p in paths:
        assert client.get(p, headers=h).status_code in (403, 404)


def test_overlay_views_for_dynamic_are_404(client, examiner):
    from test_api import strokes
    r = client.post("/api/clients", headers=examiner, json={"full_name": "Dyn Overlay"})
    cid = r.json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [strokes(3, 0.5 + 0.1 * i) for i in range(5)]})
    assert r.status_code == 200, r.text
    res = client.post("/api/screen/dynamic", headers=examiner, json={"test": strokes(3, 0.6), "client_id": cid})
    assert res.status_code == 200, res.text
    for p in ("overlay", "feature-marks"):
        assert client.get(f"/api/verifications/{res.json()['id']}/{p}", headers=examiner).status_code == 404


def test_align_with_itself_is_identity():
    r = _ink(_img())
    _, info = align_ink(r, r)
    assert abs(info["dx"]) < 0.5 and abs(info["dy"]) < 0.5 and abs(info["scale"] - 1) < 0.005


def test_align_recovers_a_shift_and_stays_in_limits():
    r = _ink(_img())
    moved = _warp(r.astype(np.uint8) * 255, 1.0, 9, -6, cv2.INTER_NEAREST) > 127
    _, info = align_ink(moved, r)
    assert abs(info["dx"] + 9) <= 1 and abs(info["dy"] - 6) <= 1 and abs(info["scale"] - 1) < 0.03
    far = _warp(r.astype(np.uint8) * 255, 0.5, 80, 0, cv2.INTER_NEAREST) > 127
    _, info = align_ink(far, r)
    assert 0.8 <= info["scale"] <= 1.25 and abs(info["dx"]) <= 0.15 * 224 and abs(info["dy"]) <= 0.15 * 224


def test_feature_marks_match_feature_values_and_ink_crop():
    for seed in range(4):
        img = _img(seed, 0.5)
        marks, vals = static_feature_marks(img), static_features(img)
        assert marks["width_height_ratio"] == vals["aspect_ratio"]
        assert marks["slant"]["angle_deg"] == vals["slant"] and marks["baseline"]["tilt_deg"] == vals["baseline"]
        assert len(marks["loops"]) == vals["loops"] and len(marks["endpoints"]) == vals["endpoints"]
        assert marks["pieces"] == vals["pieces"] and marks["stroke_thickness"] == vals["thickness"]
        # The bbox is exactly ink_mask's crop, placed in the original image.
        x0, y0 = _ink_offset(img)
        h, w = ink_mask(img).shape
        assert marks["bbox"] == [x0, y0, w, h]
