"""v8.22/v8.25: size matching mode (default adaptive); capture-size notice; references-alike tip."""
import io

import cv2
import numpy as np

from app.ml import capture
from app.routers.common import ALIKE_SPREAD, threshold_strength
from test_api import _client_with_refs, signature_png


def _bigger(png_bytes, k=3.0):
    img = cv2.imdecode(np.frombuffer(png_bytes.getvalue() if hasattr(png_bytes, "getvalue") else png_bytes, np.uint8), cv2.IMREAD_COLOR)
    big = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    return io.BytesIO(cv2.imencode(".png", big)[1].tobytes())


def test_capture_check_flags_only_large_size_differences():
    assert capture.capture_check(None, [200])["checked"] is False
    assert capture.capture_check(300, [])["checked"] is False
    ok = capture.capture_check(300, [180, 200, 220])
    assert ok["checked"] and not ok["flagged"] and ok["size_ratio"] == 1.5
    assert capture.capture_check(450, [200])["flagged"]          # 2.25x larger
    assert capture.capture_check(90, [200])["flagged"]           # 2.2x smaller
    assert not capture.capture_check(110, [200])["flagged"]


def test_size_matching_modes_and_capture_notice(client, examiner, admin):
    """v8.25: adaptive by default (resize only flagged uploads, and also screen the
    original size); "always" and "off" for admins; the v8.22 switch is retired."""
    cid = _client_with_refs(client, examiner, name="Size Switch", n=7)
    shot = lambda img: client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                                   files={"file": ("q.png", img, "image/png")})
    assert client.get("/api/admin/settings", headers=admin).json()["screening"]["size_mode"] == "adaptive"

    # Adaptive: the 3x larger photo is flagged, resized, and also screened unresized.
    r = shot(_bigger(signature_png(1, jitter=0.7)))
    assert r.status_code == 200, r.text
    a = r.json()["analysis"]
    assert a["capture"]["flagged"] and a["capture"]["size_ratio"] > 2
    assert a["size_match"]["mode"] == "adaptive" and a["size_match"]["enabled"] and a["size_match"]["scale"] < 0.5
    w = a["without_resizing"]
    assert w["screening_result"] in ("consistent", "inconclusive", "inconsistent") and 0 <= w["confidence"] <= 99
    # ... a normal-size upload is left alone.
    a = shot(signature_png(1, jitter=0.7)).json()["analysis"]
    assert not a["capture"]["flagged"] and a["size_match"]["enabled"] is False and a["size_scale"] == 1.0
    assert a["without_resizing"] is None

    # Only admins can change it; the change is audited and used by new screenings.
    put = lambda h, body: client.put("/api/admin/settings/screening", headers=h, json=body)
    assert put(examiner, {"size_mode": "off"}).status_code == 403
    assert put(admin, {"size_mode": "sometimes"}).status_code == 422
    try:
        assert put(admin, {"size_mode": "off"}).json()["size_mode"] == "off"
        a = shot(_bigger(signature_png(1, jitter=0.7))).json()["analysis"]
        assert a["size_match"] == {"enabled": False, "mode": "off", "scale": 1.0} and a["without_resizing"] is None
        assert a["capture"]["flagged"]          # the notice is about the upload, before any resize
        assert put(admin, {"size_mode": "always"}).json() == {"size_mode": "always"}
        a = shot(_bigger(signature_png(1, jitter=0.7))).json()["analysis"]
        assert a["size_match"]["mode"] == "always" and a["size_match"]["scale"] < 0.5
        log = client.get("/api/admin/audit", headers=admin)
        assert log.status_code == 200 and "size matching to always" in log.text
    finally:
        put(admin, {"size_mode": "adaptive"})


def test_alike_tip_from_reference_spread():
    tight = threshold_strength(10, sittings=1, spread=ALIKE_SPREAD - 0.01)
    assert tight["alike_tip"] and "very alike" in tight["alike_tip"] and tight["sitting_tip"] is None
    loose = threshold_strength(10, sittings=1, spread=ALIKE_SPREAD + 0.03)
    assert loose["alike_tip"] is None and loose["sitting_tip"]
    assert threshold_strength(5, sittings=1, spread=0.01)["alike_tip"] is None      # not enough references yet
    assert threshold_strength(10, sittings=2)["alike_tip"] is None                  # no spread known
