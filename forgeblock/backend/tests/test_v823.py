"""v8.23: per-reference "captured differently" flag on the static signature card."""
import cv2
import numpy as np

from test_api import signature_png, strokes


def _bigger(png: bytes, k: float = 3.0) -> bytes:
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    return cv2.imencode(".png", cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC))[1].tobytes()


def _refs(card):
    return {p["id"]: p for p in card["static_references"]}


def test_reference_captured_differently_is_flagged_until_kept(client, examiner, examiner2):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Capture v823"}).json()["id"]
    files = [("files", (f"s{i}.png", signature_png(1, jitter=0.6 + 0.1 * i), "image/png")) for i in range(3)]
    files.append(("files", ("big.png", _bigger(signature_png(1, jitter=0.9)), "image/png")))
    r = client.post(f"/api/clients/{cid}/static/enroll", headers=examiner, files=files)
    assert r.status_code == 200 and len(r.json()["accepted"]) == 4, r.text

    refs = _refs(client.get(f"/api/clients/{cid}", headers=examiner).json())
    flagged = [p for p in refs.values() if p["capture_flag"] and p["capture_flag"]["flagged"]]
    assert len(flagged) == 1, [p["capture_flag"] for p in refs.values()]
    big = flagged[0]
    assert big["capture_flag"]["size_ratio"] > 2.0
    normal = [p for p in refs.values() if p["id"] != big["id"]]
    assert all(p["capture_flag"] and not p["capture_flag"]["flagged"] for p in normal)
    for p in refs.values():  # the shape flag is separate and unchanged
        assert "flagged" in p and "consistency" in p

    url = f"/api/clients/{cid}/references/{big['id']}/capture-ack"
    assert client.patch(url, headers=examiner2).status_code == 404  # not their client
    assert client.patch(f"/api/clients/{cid + 999}/references/{big['id']}/capture-ack",
                        headers=examiner).status_code == 404  # wrong client in the path
    assert client.patch(url, headers=examiner).status_code == 200

    kept = _refs(client.get(f"/api/clients/{cid}", headers=examiner).json())[big["id"]]
    assert kept["capture_flag"]["flagged"] is False and kept["capture_flag"]["acknowledged"] is True


def test_too_few_references_are_not_checked(client, examiner):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Capture few"}).json()["id"]
    files = [("files", ("a.png", signature_png(2, jitter=0.6), "image/png")),
             ("files", ("b.png", _bigger(signature_png(2, jitter=0.7)), "image/png"))]
    assert client.post(f"/api/clients/{cid}/static/enroll", headers=examiner, files=files).status_code == 200
    refs = client.get(f"/api/clients/{cid}", headers=examiner).json()["static_references"]
    assert all(p["capture_flag"] is None for p in refs)


def test_dynamic_references_never_get_a_capture_flag(client, examiner):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Dyn v823", "is_practice": True}).json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [strokes(5, 0.5 + 0.1 * i) for i in range(5)]})
    assert r.status_code == 200, r.text
    refs = client.get(f"/api/clients/{cid}", headers=examiner).json()["dynamic_references"]
    assert refs and all(p["capture_flag"] is None for p in refs)
    pid = refs[0]["id"]
    assert client.patch(f"/api/clients/{cid}/references/{pid}/capture-ack", headers=examiner).status_code == 404
