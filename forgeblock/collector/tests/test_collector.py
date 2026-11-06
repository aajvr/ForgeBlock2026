import io
import math
import os
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("COLLECTOR_KEY", "test-key")
    monkeypatch.setenv("COLLECTOR_DATA", str(tmp_path))
    for m in ("app", "sheets"):
        sys.modules.pop(m, None)
    import app as collector
    from fastapi.testclient import TestClient

    c = TestClient(collector.app)
    c.headers["X-Collector-Key"] = "test-key"
    return c


def strokes(n=60):
    return [
        {"x": 50 + i * 4, "y": 150 + 30 * math.sin(i / 5), "t": 1000 + i * 8, "pen": 0 if i in (30, 31) else 1,
         "azimuth": 45, "altitude": 60, "pressure": 0.5}
        for i in range(n)
    ]


def start(client, code):
    r = client.post("/api/sessions", json={"code": code, "consent": True, "researcher": "R"})
    assert r.status_code == 200, r.text
    return r.json()


def test_key_required(client):
    assert client.get("/api/sessions", headers={"X-Collector-Key": "nope"}).status_code == 401


def test_consent_required(client):
    r = client.post("/api/sessions", json={"code": "P001", "consent": False, "researcher": "R"})
    assert r.status_code == 400


def test_svc_files_and_target_assignment(client, tmp_path):
    p1 = start(client, "P001")
    assert p1["target"] is None  # first participant has nobody to forge
    for _ in range(20):
        assert client.post("/api/sessions/P001/dynamic", json={"kind": "genuine", "points": strokes(), "height": 300}).status_code == 200
    assert client.post("/api/sessions/P001/dynamic", json={"kind": "genuine", "points": strokes(), "height": 300}).status_code == 409

    lines = (tmp_path / "dynamic" / "U1S1.TXT").read_text().split("\n")
    assert lines[0] == "60"
    x, y, t, pen, az, alt, p = map(int, lines[1].split())
    assert (x, y, t, pen, az, alt, p) == (500, 1500, 0, 1, 1350, 600, 512)  # y flipped: (300-150)*10; azimuth 45 + 90 deg

    p2 = start(client, "P002")
    assert p2["target"] == "P001"
    r = client.post("/api/sessions/P002/dynamic", json={"kind": "forged", "points": strokes(), "height": 300})
    assert r.json()["file"] == "U1S21.TXT"
    assert client.get("/api/sessions/P002/reference").json()["target"] == "P001"
    assert client.delete("/api/sessions/P002/dynamic/last?kind=forged").json()["deleted"] == "U1S21.TXT"

    p3 = start(client, "P003")
    assert p3["target"] is None  # P001 already has a forger, P002 has no iPad genuine yet


def test_sheet_import_and_export(client):
    import sheets

    start(client, "P001")
    img = np.array(sheets.render_template(participant="P001", kind="genuine"))
    for i in range(1, 21):
        if i == 5:
            continue
        x, y, w, h = sheets.box_rect(i)
        cv2.putText(img, "Sig", (int((x + 0.5) * 300), int((y + 0.9) * 300)), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 4, 0, 8)
    ok, png = cv2.imencode(".png", img)
    r = client.post("/api/sheets/preview", data={"code": "P001", "kind": "genuine"}, files={"scan": ("s.png", png.tobytes(), "image/png")})
    assert r.status_code == 200, r.text
    boxes = r.json()["boxes"]
    assert [b["index"] for b in boxes if b["empty"]] == [5]
    r = client.post("/api/sheets/save", json={"code": "P001", "kind": "genuine", "keep": [b["index"] for b in boxes if not b["empty"]]})
    assert len(r.json()["saved"]) == 19
    assert client.get("/api/sessions/P001").json()["progress"]["paper_genuine"] == 19

    client.post("/api/sessions/P001/dynamic", json={"kind": "genuine", "points": strokes(), "height": 300})
    z = zipfile.ZipFile(io.BytesIO(client.get("/api/export").content))
    names = z.namelist()
    assert "dynamic/U1S1.TXT" in names and "static/P001/genuine/P001_G01.png" in names and "manifest.csv" in names


def test_bad_scan(client):
    start(client, "P001")
    blank = cv2.imencode(".png", np.full((850, 1100), 255, np.uint8))[1].tobytes()
    r = client.post("/api/sheets/preview", data={"code": "P001", "kind": "genuine"}, files={"scan": ("s.png", blank, "image/png")})
    assert r.status_code == 422


def test_withdraw_deletes_data(client, tmp_path):
    start(client, "P001")
    client.post("/api/sessions/P001/dynamic", json={"kind": "genuine", "points": strokes(), "height": 300})
    r = client.post("/api/sessions/P001/withdraw")
    assert r.json()["withdrawn"] is True
    assert not (tmp_path / "dynamic" / "U1S1.TXT").exists()


def test_template_pdf(client):
    r = client.get("/api/template?participant=P001&kind=genuine")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def link(client, code, hours=72):
    r = client.post(f"/api/sessions/{code}/link", json={"hours": hours})
    assert r.status_code == 200, r.text
    return r.json()["path"].split("#", 1)[1]


def test_participant_link_flow(client, tmp_path):
    import sheets

    start(client, "P001")
    token = link(client, "P001")
    assert "link" not in client.get("/api/sessions/P001").json()  # hash never sent out
    anon = client.__class__(client.app)  # no researcher key
    hdr = {"X-Participant-Token": token}
    assert anon.get("/api/sessions").status_code == 401
    s = anon.get("/api/p/session", headers=hdr).json()
    assert s["code"] == "P001" and s["has_target"] is False and "notes" not in s
    # finger is refused, pencil accepted
    assert anon.post("/api/p/dynamic", headers=hdr, json={"kind": "genuine", "points": strokes(), "height": 300, "pointer": "touch"}).status_code == 400
    r = anon.post("/api/p/dynamic", headers=hdr, json={"kind": "genuine", "points": strokes(), "height": 300, "pointer": "pen"})
    assert r.json()["file"] == "U1S1.TXT"
    assert anon.delete("/api/p/dynamic/last?kind=genuine", headers=hdr).json()["progress"]["dynamic_genuine"] == 0
    assert anon.get("/api/p/template?kind=genuine", headers=hdr).content[:4] == b"%PDF"
    assert anon.get("/api/p/template?kind=forgery", headers=hdr).status_code == 404  # no target

    # photo upload goes to review, not straight into the dataset
    img = np.array(sheets.render_template(participant="P001", kind="genuine"))
    for i in range(1, 21):
        x, y, w, h = sheets.box_rect(i)
        cv2.putText(img, "Sig", (int((x + 0.5) * 300), int((y + 0.9) * 300)), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 4, 0, 8)
    png = cv2.imencode(".png", img)[1].tobytes()
    r = anon.post("/api/p/sheet", headers=hdr, data={"kind": "genuine"}, files={"scan": ("s.png", png, "image/png")})
    assert r.status_code == 200, r.text and r.json()["boxes_found"] == 20
    assert client.get("/api/sessions/P001").json()["progress"]["paper_genuine"] == 0
    pend = client.get("/api/sheets/pending").json()["pending"]
    assert pend[0]["code"] == "P001" and pend[0]["source"] == "participant"
    client.post("/api/sheets/save", json={"code": "P001", "kind": "genuine", "keep": list(range(1, 21))})
    assert client.get("/api/sessions/P001").json()["progress"]["paper_genuine"] == 20

    # finishing ends the link
    assert anon.post("/api/p/finish", headers=hdr).status_code == 200
    assert anon.get("/api/p/session", headers=hdr).status_code == 401


def test_participant_link_limits(client):
    start(client, "P001")
    start(client, "P002")
    t1 = link(client, "P001")
    t1b = link(client, "P001")  # replaces the old link
    anon = client.__class__(client.app)
    assert anon.get("/api/p/session", headers={"X-Participant-Token": t1}).status_code == 401
    assert anon.get("/api/p/session", headers={"X-Participant-Token": t1b}).json()["code"] == "P001"
    # revoked
    client.delete("/api/sessions/P001/link")
    assert anon.get("/api/p/session", headers={"X-Participant-Token": t1b}).status_code == 401
    # expired
    import json as _json
    t2 = link(client, "P002", hours=1)
    import app as collector
    f = collector.pdir("P002") / "session.json"
    d = _json.loads(f.read_text()); d["link"]["expires_at"] = "2020-01-01T00:00:00+00:00"; f.write_text(_json.dumps(d))
    assert anon.get("/api/p/session", headers={"X-Participant-Token": t2}).status_code == 410


def test_wrong_key_lockout(client):
    anon = client.__class__(client.app)
    for _ in range(10):
        assert anon.get("/api/check-key", headers={"X-Collector-Key": "bad"}).status_code == 401
    assert anon.get("/api/check-key", headers={"X-Collector-Key": "test-key"}).status_code == 429
