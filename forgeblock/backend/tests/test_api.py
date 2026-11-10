"""End-to-end API tests. Run from backend/:  pytest -q"""
from datetime import timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest
from conftest import login, make_user

from app.database import SessionLocal
from app.models import User


def signature_png(seed: int, jitter: float = 0.0) -> bytes:
    """Draws a synthetic cursive-like stroke on white paper."""
    rng = np.random.default_rng(seed)
    img = np.full((220, 520, 3), 245, np.uint8)
    base = rng.uniform(0, 2 * np.pi, 4)
    xs = np.linspace(40, 480, 300)
    ys = 110 + sum(25 * np.sin(xs / (30 + 10 * i) + base[i]) for i in range(4)) / 2
    ys = ys + np.random.default_rng(seed * 7 + int(jitter * 100)).normal(0, jitter, ys.shape)
    pts = np.stack([xs, ys], 1).astype(np.int32)
    cv2.polylines(img, [pts], False, (20, 20, 20), 3, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes()


def blank_png() -> bytes:
    ok, buf = cv2.imencode(".png", np.full((200, 400, 3), 250, np.uint8))
    return buf.tobytes()


def strokes(seed: int, jitter: float = 0.0) -> list:
    rng = np.random.default_rng(seed)
    noise = np.random.default_rng(seed + int(jitter * 1000))
    out, t = [], 0.0
    for s in range(3):
        phase = rng.uniform(0, 6)
        stroke = []
        for i in range(60):
            t += 8 + noise.normal(0, jitter)
            stroke.append({"x": 100 * s + i * 2 + noise.normal(0, jitter),
                           "y": 50 + 30 * np.sin(i / 6 + phase) + noise.normal(0, jitter), "t": t,
                           "pressure": 0.4 + 0.1 * np.sin(i / 5)})
        out.append(stroke)
        t += 120
    return out


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["models"]["static"]["kind"] == "placeholder"


def test_no_self_registration(client):
    r = client.post("/api/auth/register", json={"full_name": "X", "email": "x@example.com", "password": "password123"})
    assert r.status_code in (404, 405)


def test_requires_login(client):
    assert client.get("/api/clients").status_code == 401


def test_lockout_after_failed_logins(client, admin):
    make_user(client, admin, "lock@example.com")
    for _ in range(4):
        assert client.post("/api/auth/login", json={"email": "lock@example.com", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "lock@example.com", "password": "nope"}).status_code == 423
    # Even the right password is refused while locked.
    assert client.post("/api/auth/login", json={"email": "lock@example.com", "password": "examiner123"}).status_code == 423


def test_idle_timeout(client, admin):
    h = make_user(client, admin, "idle@example.com")
    with SessionLocal() as db:
        u = db.query(User).filter_by(email="idle@example.com").one()
        u.last_seen = u.last_seen - timedelta(minutes=16)
        db.commit()
    r = client.get("/api/clients", headers=h)
    assert r.status_code == 401 and "without activity" in r.json()["detail"]


def _client_with_refs(c, h, name="Juan Dela Cruz", n=7):
    r = c.post("/api/clients", headers=h, json={"full_name": name})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    files = [("files", (f"s{i}.png", signature_png(1, jitter=0.6 + 0.1 * i), "image/png")) for i in range(n)]
    r = c.post(f"/api/clients/{cid}/static/enroll", headers=h, files=files)
    assert r.status_code == 200, r.text
    assert len(r.json()["accepted"]) == n
    return cid


def test_static_screening_case_and_finding(client, examiner, examiner2, admin):
    cid = _client_with_refs(client, examiner)
    card = client.get(f"/api/clients/{cid}", headers=examiner).json()
    assert card["static_strength"]["level"] == "basic"
    assert len(card["static_references"]) == 7

    # Blank uploads are rejected by the quality check.
    r = client.post(f"/api/clients/{cid}/static/enroll", headers=examiner,
                    files=[("files", ("blank.png", blank_png(), "image/png"))])
    assert r.json()["rejected"] and not r.json()["accepted"]

    case = client.post("/api/cases", headers=examiner,
                       json={"title": "Evaluation task 1", "client_id": cid, "document_ref": "Q-1023"}).json()

    # A finding needs at least one screening.
    r = client.post(f"/api/cases/{case['id']}/finding", headers=examiner, json={"finding": "genuine", "reason": "looks fine"})
    assert r.status_code == 409

    r = client.post("/api/screen/static", headers=examiner,
                    data={"client_id": str(cid), "case_id": str(case["id"]), "expected_label": "forged"},
                    files={"file": ("q.png", signature_png(99), "image/png")})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["screening_result"] in ("consistent", "inconclusive", "inconsistent")
    assert res["threshold_source"] == "adaptive"
    assert res["receipt_code"].startswith("FB-")
    assert res["caption"] and res["disclaimer"]
    assert res["integrity"]["valid"]
    assert res["analysis"]["features"]["items"]
    assert res["best_match_profile_id"] in [p["id"] for p in card["static_references"]]
    assert res["document_ref"] == "Q-1023"

    # Overlay for static screenings; the heatmap was removed in v7.
    r = client.get(f"/api/verifications/{res['id']}/overlay", headers=examiner)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get(f"/api/verifications/{res['id']}/heatmap", headers=examiner).status_code == 404

    # Public receipt check, no sign-in.
    r = client.get(f"/api/receipts/{res['receipt_code']}")
    assert r.status_code == 200 and r.json()["intact"]

    # Inconclusive is no longer a finding; the examiner decides Genuine or Forged.
    r = client.post(f"/api/cases/{case['id']}/finding", headers=examiner,
                    json={"finding": "inconclusive", "reason": "Not sure."})
    assert r.status_code == 422
    # Other examiners cannot see the case or give its finding.
    assert client.get(f"/api/cases/{case['id']}", headers=examiner2).status_code == 404
    assert client.post(f"/api/cases/{case['id']}/finding", headers=examiner2,
                       json={"finding": "genuine", "reason": "x x x"}).status_code == 404
    # One examiner decides: a Forged finding closes the case.
    r = client.post(f"/api/cases/{case['id']}/finding", headers=examiner,
                    json={"finding": "forged", "reason": "Different letter forms."})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed"
    assert client.post(f"/api/cases/{case['id']}/second-opinion", headers=admin,
                       json={"agree": True, "note": "x"}).status_code in (404, 405)
    detail = client.get(f"/api/cases/{case['id']}", headers=examiner).json()
    assert detail["findings"][0]["block_index"] is not None
    kinds = [e["kind"] for e in detail["timeline"]]
    assert kinds[:3] == ["opened", "screening", "finding"] and kinds[-1] == "closed"

    # The ledger holds the screening and the finding, and is intact.
    v = client.get("/api/ledger/validate", headers=admin).json()
    assert v["valid"] and v["chain_height"] >= 2
    types = {b["record_type"] for b in client.get("/api/ledger/blocks", headers=admin).json()["blocks"]}
    assert {"verification", "finding"} <= types


def test_ledger_admin_only_and_tamper_detected(client, examiner, admin):
    assert client.get("/api/ledger/blocks", headers=examiner).status_code == 403
    assert client.get("/api/ledger/validate", headers=examiner).status_code == 403
    cid = _client_with_refs(client, examiner, "Tamper Test")
    res = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                      files={"file": ("q.png", signature_png(1, 0.7), "image/png")}).json()
    original = res["screening_result"]
    other = "inconsistent" if original != "inconsistent" else "consistent"
    assert client.post(f"/api/ledger/demo/tamper/{res['id']}", headers=examiner,
                       json={"screening_result": other}).status_code == 403
    client.post(f"/api/ledger/demo/tamper/{res['id']}", headers=admin, json={"screening_result": other})
    v = client.get("/api/ledger/validate", headers=admin).json()
    assert not v["valid"]
    assert not client.get(f"/api/receipts/{res['receipt_code']}").json()["intact"]
    client.post(f"/api/ledger/demo/restore/{res['id']}", headers=admin, json={"screening_result": original})
    assert client.get("/api/ledger/validate", headers=admin).json()["valid"]


def test_dynamic_flow(client, examiner):
    cid = client.post("/api/clients", headers=examiner, json={"full_name": "Practice", "is_practice": True}).json()["id"]
    r = client.post(f"/api/clients/{cid}/dynamic/enroll", headers=examiner,
                    json={"samples": [strokes(5, 0.5 + 0.1 * i) for i in range(5)]})
    assert r.status_code == 200 and len(r.json()["accepted"]) == 5, r.text
    assert r.json()["client"]["client_code"].startswith("PR-")
    r = client.post("/api/screen/dynamic", headers=examiner, json={"test": strokes(5, 0.6), "client_id": cid})
    assert r.status_code == 200, r.text
    res = r.json()
    assert set(res["votes"]) == {"cosine", "euclidean"}
    names = [i["name"] for i in res["analysis"]["features"]["items"]]
    assert "duration" in names and "pen_lifts" in names
    s = client.get(f"/api/verifications/{res['id']}/strokes", headers=examiner).json()["strokes"]
    assert len(s) == 3


def test_compare_and_review_queue_removed(client, examiner):
    paths = client.app.openapi()["paths"]
    assert not any(p.startswith("/api/compare") for p in paths)
    assert "/api/review-queue" not in paths and "/api/reports" not in paths


def test_client_account_sees_only_own_checks(client, admin, examiner):
    cid = _client_with_refs(client, examiner, "Maria Santos")
    other = _client_with_refs(client, examiner, "Someone Else")
    own = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                      files={"file": ("q.png", signature_png(1, 0.7), "image/png")}).json()
    theirs = client.post("/api/screen/static", headers=examiner, data={"client_id": str(other)},
                         files={"file": ("q.png", signature_png(1, 0.7), "image/png")}).json()
    h = make_user(client, admin, "maria@example.com", role="client", client_id=cid)
    card = client.get("/api/me/client", headers=h).json()
    assert [c["id"] for c in card["checks"]] == [own["id"]]
    assert client.get(f"/api/verifications/{theirs['id']}", headers=h).status_code == 404
    assert client.get("/api/clients", headers=h).status_code == 403
    assert client.get(f"/api/verifications/{own['id']}/image", headers=h).status_code == 403
    assert client.post("/api/me/request-deletion", headers=h).status_code == 200


def test_records(client, admin):
    assert client.get("/api/admin/performance?modality=static", headers=admin).status_code == 404
    r = client.get("/api/records", headers=admin)
    assert r.status_code == 200 and r.json()["summary"]["total"] >= 1
    r = client.get("/api/records?modality=static&date_from=2020-01-01&date_to=2100-01-01", headers=admin)
    assert all(x["modality"] == "static" for x in r.json()["records"])
    dash = client.get("/api/admin/dashboard", headers=admin).json()
    assert dash["totals"]["screenings"] >= 1


def test_policy_and_bulk_accounts(client, admin):
    # The Strict/Balanced/Lenient presets were removed; the cut-off is not exposed.
    assert client.put("/api/admin/settings/policy", headers=admin, json={"preset": "strict"}).status_code in (404, 405)
    assert "policy" not in client.get("/api/admin/settings", headers=admin).json()
    r = client.post("/api/admin/users/bulk", headers=admin, json={"prefix": "EVAL", "start": 1, "count": 3})
    assert [u["account_code"] for u in r.json()["created"]] == ["EVAL-01", "EVAL-02", "EVAL-03"]
    assert client.get("/api/admin/audit", headers=admin).json()


def test_retention_deletes_data_but_keeps_chain(client, admin, examiner):
    cid = _client_with_refs(client, examiner, "Old Client")
    client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                files={"file": ("q.png", signature_png(1, 0.7), "image/png")})
    client.post(f"/api/admin/clients/{cid}/retention?days=0", headers=admin)
    client.delete(f"/api/clients/{cid}", headers=admin)
    assert client.get(f"/api/clients/{cid}", headers=examiner).status_code == 404
    assert client.get("/api/ledger/validate", headers=admin).json()["valid"]


def test_dynamic_upload_is_validated(client, admin):
    import io
    import zipfile

    from app.config import WEIGHTS_DIR

    bad = client.post("/api/admin/model/dynamic-weights", headers=admin,
                      files={"file": ("model.pt", b"not a model", "application/octet-stream")})
    assert bad.status_code == 422
    assert not (WEIGHTS_DIR / "dynamic_encoder.pt").exists()

    real = Path(__file__).resolve().parents[1] / "weights" / "dynamic_encoder.pt"
    if not real.exists():
        pytest.skip("no trained dynamic model in backend/weights")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.write(real, "svc_dynamic_model_E2/best_model.pt")
    r = client.post("/api/admin/model/dynamic-weights", headers=admin,
                    files={"file": ("bundle.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200 and r.json()["kind"] == "pytorch-svc", r.text
    (WEIGHTS_DIR / "dynamic_encoder.pt").unlink()  # the rest of the tests use the placeholder
