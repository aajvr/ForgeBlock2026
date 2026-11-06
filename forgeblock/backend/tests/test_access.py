"""Chapter 3, Section 3.8 (System Access Control and Ethical Use).
Shares the app and database with test_api.py; run from backend/: pytest -q"""
from pathlib import Path

from conftest import login
from test_api import _client_with_refs, signature_png


def test_research_terms_required_before_use(client, admin):
    r = client.post("/api/admin/users", headers=admin,
                    json={"full_name": "New", "email": "terms@example.com", "role": "examiner"})
    temp = r.json()["temporary_password"]
    h = login(client, "terms@example.com", temp)
    client.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": "examiner123"})
    me = client.get("/api/auth/me", headers=h).json()
    assert me["research_use_accepted"] is False
    assert client.get("/api/clients", headers=h).status_code == 403
    assert client.get("/api/auth/research-use").json()["terms"]
    assert client.post("/api/auth/research-use/accept", headers=h).json()["research_use_accepted"]
    assert client.get("/api/clients", headers=h).status_code == 200


def test_examiners_see_only_their_own(client, examiner, examiner2):
    cid = _client_with_refs(client, examiner, "Isolation A")
    card = client.get(f"/api/clients/{cid}", headers=examiner).json()
    ref = card["static_references"][0]["id"]
    res = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                      files={"file": ("q.png", signature_png(1, 0.7), "image/png")}).json()
    case = client.post("/api/cases", headers=examiner, json={"title": "Task", "client_id": cid}).json()

    assert cid not in [c["id"] for c in client.get("/api/clients", headers=examiner2).json()]
    assert client.get(f"/api/clients/{cid}", headers=examiner2).status_code == 404
    assert client.get(f"/api/references/{ref}/image", headers=examiner2).status_code == 404
    assert client.get(f"/api/verifications/{res['id']}", headers=examiner2).status_code == 404
    assert client.get(f"/api/verifications/{res['id']}/image", headers=examiner2).status_code == 404
    assert client.get(f"/api/cases/{case['id']}", headers=examiner2).status_code == 404
    assert case["id"] not in [c["id"] for c in client.get("/api/cases?scope=all", headers=examiner2).json()]
    assert client.post("/api/screen/static", headers=examiner2, data={"client_id": str(cid)},
                       files={"file": ("q.png", signature_png(1), "image/png")}).status_code == 404
    found = client.get("/api/search?q=Isolation", headers=examiner2).json()
    assert not found["clients"] and not found["receipts"]
    assert all(r["id"] != res["id"] for r in client.get("/api/checks/mine", headers=examiner2).json())


def test_images_are_view_only(client, examiner):
    cid = _client_with_refs(client, examiner, "Headers")
    ref = client.get(f"/api/clients/{cid}", headers=examiner).json()["static_references"][0]["id"]
    r = client.get(f"/api/references/{ref}/image", headers=examiner)
    assert r.status_code == 200
    assert r.headers["content-disposition"] == "inline"
    assert "no-store" in r.headers["cache-control"]
    # No export endpoints for signature images.
    paths = set(client.app.openapi()["paths"])
    assert not [p for p in paths if "export" in p or "download" in p]


def test_admin_limited_to_research_team(client, admin):
    r = client.post("/api/admin/users", headers=admin,
                    json={"full_name": "Outsider", "email": "outsider@example.com", "role": "admin"})
    assert r.status_code == 403
    r = client.post("/api/admin/users", headers=admin,
                    json={"full_name": "Promote", "email": "promote@example.com", "role": "examiner"})
    uid = r.json()["id"]
    assert client.patch(f"/api/admin/users/{uid}", headers=admin, json={"role": "admin"}).status_code == 403
    pol = client.get("/api/admin/access-policy", headers=admin).json()
    assert pol["self_registration"] is False and pol["image_export"] is False
    assert all(a["in_research_team"] for a in pol["admins"])


def test_test_accounts_use_prepared_clients(client, admin, examiner):
    created = client.post("/api/admin/users/bulk", headers=admin,
                          json={"prefix": "EVAL", "start": 40, "count": 2}).json()["created"]
    heads = []
    for acc in created:
        h = login(client, acc["email"], acc["temporary_password"])
        client.post("/api/auth/change-password", headers=h,
                    json={"current_password": acc["temporary_password"], "new_password": "examiner123"})
        me = client.post("/api/auth/research-use/accept", headers=h).json()
        assert me["is_test_account"]
        heads.append(h)
    eval1, eval2 = heads
    # A test account can never be made an admin.
    uid = client.get("/api/admin/users?q=EVAL-40", headers=admin).json()[0]["id"]
    assert client.patch(f"/api/admin/users/{uid}", headers=admin, json={"role": "admin"}).status_code == 403

    # The research team prepares a test client and assigns it to all test accounts.
    prepared = _client_with_refs(client, admin, "Prepared test client")
    assert client.get(f"/api/clients/{prepared}", headers=eval1).status_code == 404
    r = client.put(f"/api/admin/clients/{prepared}/access", headers=admin, json={"all_test_accounts": True})
    assert r.status_code == 200 and len(r.json()["user_ids"]) >= 2
    card = client.get(f"/api/clients/{prepared}", headers=eval1).json()
    assert card["shared_with_me"] and not card["can_edit"]
    assert prepared not in [c["id"] for c in client.get("/api/clients", headers=examiner).json()]
    # Read-only for respondents: they screen against it but cannot change it.
    ref = card["static_references"][0]["id"]
    assert client.delete(f"/api/references/{ref}", headers=eval1).status_code == 403
    assert client.post(f"/api/clients/{prepared}/static/enroll", headers=eval1,
                       files=[("files", ("a.png", signature_png(5), "image/png"))]).status_code == 403
    a = client.post("/api/screen/static", headers=eval1, data={"client_id": str(prepared)},
                    files={"file": ("q.png", signature_png(1, 0.7), "image/png")}).json()
    b = client.post("/api/screen/static", headers=eval2, data={"client_id": str(prepared)},
                    files={"file": ("q.png", signature_png(1, 0.8), "image/png")}).json()
    # Each respondent sees only their own screenings on the shared client.
    checks = [c["id"] for c in client.get(f"/api/clients/{prepared}", headers=eval1).json()["checks"]]
    assert a["id"] in checks and b["id"] not in checks
    assert client.get(f"/api/verifications/{b['id']}", headers=eval1).status_code == 404
    # Clients a test account registers are always practice clients.
    own = client.post("/api/clients", headers=eval1, json={"full_name": "My practice"}).json()
    assert own["is_practice"] and own["client_code"].startswith("PR-")
    # Labels are optional; the code identifies the client.
    anon = client.post("/api/clients", headers=eval1, json={}).json()
    assert anon["full_name"] == anon["client_code"]


def test_rls_covers_every_table():
    from app.database import Base

    sql = (Path(__file__).resolve().parents[2] / "supabase" / "rls.sql").read_text()
    for table in Base.metadata.tables:
        assert f"public.{table} " in sql or f"public.{table}\n" in sql, table
