"""v8.18: notifications for all three roles, admin-only examiner/group/actor
filters on cases, records and the audit log."""
from conftest import login, make_user


def _me(c, h):
    return c.get("/api/auth/me", headers=h).json()


def _client_login(c, account):
    h = login(c, account["email"], account["temporary_password"])
    assert c.post("/api/auth/change-password", headers=h,
                  json={"current_password": account["temporary_password"], "new_password": "client12345"}).status_code == 200
    assert c.post("/api/auth/research-use/accept", headers=h).status_code == 200
    return h


def _notes(c, h):
    r = c.get("/api/notifications", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_notifications_end_to_end(client, admin):
    ex_a = make_user(client, admin, "notify-a@example.com")
    ex_b = make_user(client, admin, "notify-b@example.com")
    a_id, b_id = _me(client, ex_a)["id"], _me(client, ex_b)["id"]
    ga = client.post("/api/groups", headers=admin, json={"name": "Notify A", "examiner_id": a_id}).json()
    gb = client.post("/api/groups", headers=admin, json={"name": "Notify B", "examiner_id": b_id}).json()

    # A client with its own account, in group A.
    r = client.post("/api/clients", headers=admin, json={"full_name": "Notify Client", "email": "notify-client@example.com",
                                                         "group_id": ga["id"]})
    assert r.status_code == 200, r.text
    cl = r.json()
    ch = _client_login(client, cl["new_account"])

    # A case opened by hand: client, group examiner and the other admins hear about it, not the opener.
    r = client.post("/api/cases", headers=admin, json={"title": "Deed of sale", "client_id": cl["id"]})
    assert r.status_code == 200, r.text
    case = r.json()
    cn = _notes(client, ch)
    assert cn["unread"] >= 1
    item = cn["items"][0]
    assert item["type"] == "case_opened" and item["link"] == "/app/me"
    # Client wording never shows scores or thresholds.
    assert "%" not in (item["title"] + (item["body"] or "")) and "threshold" not in (item["body"] or "").lower()
    an = _notes(client, ex_a)["items"][0]
    assert an["link"] == f"/app/cases/{case['id']}"
    assert not any(n["entity_id"] == case["id"] and n["type"] == "case_opened"
                   for n in _notes(client, admin)["items"])

    # Moving the client tells the old and the new examiner.
    assert client.patch(f"/api/clients/{cl['id']}", headers=admin, json={"group_id": gb["id"]}).status_code == 200
    assert _notes(client, ex_a)["items"][0]["type"] == "client_moved"
    moved = _notes(client, ex_b)["items"][0]
    assert moved["type"] == "client_moved" and moved["link"] == f"/app/clients/{cl['id']}"

    # Role change tells that user.
    assert client.patch(f"/api/admin/users/{b_id}", headers=admin, json={"role": "client"}).status_code == 200
    assert _notes(client, ex_b)["items"][0]["type"] == "role"

    # Mark one read, then all; users only touch their own.
    first = _notes(client, ex_a)["items"][0]
    assert client.post(f"/api/notifications/{first['id']}/read", headers=ch).status_code == 404
    r = client.post(f"/api/notifications/{first['id']}/read", headers=ex_a)
    assert r.status_code == 200
    assert next(n for n in _notes(client, ex_a)["items"] if n["id"] == first["id"])["read"]
    assert client.post("/api/notifications/read-all", headers=ex_a).json()["unread"] == 0
    assert client.get("/api/notifications/unread-count", headers=ex_a).json() == {"unread": 0}

    # Paging.
    page = client.get("/api/notifications?limit=1", headers=ex_a).json()
    assert len(page["items"]) == 1 and page["has_more"]
    nxt = client.get(f"/api/notifications?limit=1&before={page['items'][0]['id']}", headers=ex_a).json()
    assert nxt["items"][0]["id"] < page["items"][0]["id"]


def test_admin_only_filters(client, admin, examiner):
    ex_id = _me(client, examiner)["id"]
    assert client.get(f"/api/cases?examiner_id={ex_id}", headers=examiner).status_code == 403
    assert client.get(f"/api/cases?scope=all&examiner_id={ex_id}", headers=admin).status_code == 200
    assert client.get(f"/api/records?examiner_id={ex_id}", headers=examiner).status_code == 403
    assert client.get("/api/records?group_id=0", headers=examiner).status_code == 403
    assert client.get(f"/api/records?examiner_id={ex_id}&group_id=0", headers=admin).status_code == 200
    actors = client.get("/api/admin/audit/actors", headers=admin)
    assert actors.status_code == 200 and actors.json()["users"]
    assert client.get("/api/admin/audit/actors", headers=examiner).status_code == 403
    uid = actors.json()["users"][0]["id"]
    rows = client.get(f"/api/admin/audit?user_id={uid}", headers=admin).json()
    assert rows and all(r["user_id"] == uid for r in rows)
    assert all(r["user_id"] is None for r in client.get("/api/admin/audit?system=true", headers=admin).json())
    roles = {u["id"]: u["role"] for u in actors.json()["users"]}
    rows = client.get("/api/admin/audit?role=examiner", headers=admin).json()
    assert rows and all(roles.get(r["user_id"]) == "examiner" for r in rows)
