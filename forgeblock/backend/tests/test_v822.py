"""v8.22: size matching is an admin switch (default off); capture-size notice; references-alike tip."""
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


def test_size_matching_switch_and_capture_notice(client, examiner, admin):
    cid = _client_with_refs(client, examiner, name="Size Switch", n=7)
    # Default: off, recorded on the result, and the 3x larger photo is flagged.
    assert client.get("/api/admin/settings", headers=admin).json()["screening"] == {"size_match": False}
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                    files={"file": ("q.png", _bigger(signature_png(1, jitter=0.7)), "image/png")})
    assert r.status_code == 200, r.text
    a = r.json()["analysis"]
    assert a["size_match"] == {"enabled": False, "scale": 1.0} and a["size_scale"] == 1.0
    assert a["capture"]["flagged"] and a["capture"]["size_ratio"] > 2

    # Only admins can switch it; the change is audited and used by new screenings.
    assert client.put("/api/admin/settings/screening", headers=examiner, json={"size_match": True}).status_code == 403
    assert client.put("/api/admin/settings/screening", headers=admin, json={"size_match": True}).json() == {"size_match": True}
    try:
        r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                        files={"file": ("q.png", _bigger(signature_png(1, jitter=0.7)), "image/png")})
        a = r.json()["analysis"]
        assert a["size_match"]["enabled"] and a["size_match"]["scale"] < 0.5
        assert a["capture"]["flagged"]          # the notice is about the upload, before any resize
        log = client.get("/api/admin/audit", headers=admin)
        assert log.status_code == 200 and "size matching on" in log.text
    finally:
        client.put("/api/admin/settings/screening", headers=admin, json={"size_match": False})


def test_alike_tip_from_reference_spread():
    tight = threshold_strength(10, sittings=1, spread=ALIKE_SPREAD - 0.01)
    assert tight["alike_tip"] and "very alike" in tight["alike_tip"] and tight["sitting_tip"] is None
    loose = threshold_strength(10, sittings=1, spread=ALIKE_SPREAD + 0.03)
    assert loose["alike_tip"] is None and loose["sitting_tip"]
    assert threshold_strength(5, sittings=1, spread=0.01)["alike_tip"] is None      # not enough references yet
    assert threshold_strength(10, sittings=2)["alike_tip"] is None                  # no spread known
