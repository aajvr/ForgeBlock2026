"""v7: cases opened automatically, one examiner decides, signatures already
examined, add as reference, Microsoft / Google sign-in, study mode."""
from conftest import login, make_user
from test_api import _client_with_refs, signature_png

from app import security, services
from app.routers import auth


def _screen(client, h, cid, png, **data):
    r = client.post("/api/screen/static", headers=h, data={"client_id": str(cid), **data},
                    files={"file": ("q.png", png, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()


def test_needs_decision_opens_case_and_examiner_decides(client, admin, monkeypatch):
    # The synthetic test signatures look alike to the model; force the result.
    monkeypatch.setattr(services, "screening_result", lambda decision, band: "inconclusive")
    ex = make_user(client, admin, "v7ex@example.com")
    cid = _client_with_refs(client, ex, "Auto Case")
    # A different hand: Inconsistent or Inconclusive, so a case opens.
    questioned = signature_png(77)
    res = _screen(client, ex, cid, questioned)
    assert res["screening_result"] in ("inconclusive", "inconsistent"), res["screening_result"]
    assert res["case"] and res["case"]["status"] == "open" and res["case"]["can_open"]
    assert res["prior_decision"] is None
    case_id = res["case"]["id"]
    home = client.get("/api/home/examiner", headers=ex).json()
    assert any(c["id"] == case_id for c in home["open_cases"])
    assert client.get("/api/cases?status=open", headers=ex).json()[0]["id"] == case_id

    # The examiner decides Genuine with notes; the case closes and is sealed.
    r = client.post(f"/api/cases/{case_id}/finding", headers=ex,
                    json={"finding": "genuine", "reason": "Written on a moving bus; same letter forms."})
    assert r.status_code == 200 and r.json()["status"] == "closed"
    assert client.get("/api/ledger/validate", headers=admin).json()["valid"]

    # The same file again: the earlier decision is shown and no new case opens.
    again = _screen(client, ex, cid, questioned)
    assert again["screening_result"] == res["screening_result"]  # the model result never changes
    assert again["case"] is None
    prior = again["prior_decision"]
    assert prior["finding"] == "genuine" and prior["case_id"] == case_id and "moving bus" in prior["reason"]

    # Add as reference after the Genuine finding (once).
    before = client.get(f"/api/clients/{cid}", headers=ex).json()["static_count"]
    r = client.post(f"/api/cases/{case_id}/add-reference", headers=ex, json={"verification_log_id": res["id"]})
    assert r.status_code == 200, r.text
    assert res["id"] in r.json()["added_references"]
    assert client.get(f"/api/clients/{cid}", headers=ex).json()["static_count"] == before + 1
    assert client.post(f"/api/cases/{case_id}/add-reference", headers=ex,
                       json={"verification_log_id": res["id"]}).status_code == 409

    # Records show the decision.
    rec = client.get("/api/records?decision=genuine", headers=ex).json()
    assert any(r["id"] == res["id"] for r in rec["records"]) and rec["summary"]["genuine"] >= 1


def test_forged_cannot_be_added_and_evaluation_samples_open_no_case(client, admin, monkeypatch):
    monkeypatch.setattr(services, "screening_result", lambda decision, band: "inconsistent")
    ex = make_user(client, admin, "v7ex2@example.com")
    cid = _client_with_refs(client, ex, "Forged Case")
    res = _screen(client, ex, cid, signature_png(78))
    case_id = res["case"]["id"]
    client.post(f"/api/cases/{case_id}/finding", headers=ex, json={"finding": "forged", "reason": "Different hand."})
    assert client.post(f"/api/cases/{case_id}/add-reference", headers=ex,
                       json={"verification_log_id": res["id"]}).status_code == 409
    # Prepared evaluation samples (known answer) never open cases.
    labeled = _screen(client, ex, cid, signature_png(79), expected_label="forged")
    assert labeled["case"] is None


def test_microsoft_google_sign_in_is_invite_only(client, admin, monkeypatch):
    assert client.get("/api/auth/providers").json()["enabled"]
    make_user(client, admin, "oauth.user@example.com")

    def fake(email, confirmed=True, provider="google"):
        return lambda token: {"email": email, "verified": confirmed, "provider": provider}

    monkeypatch.setattr(auth, "fetch_provider_user", fake("stranger@gmail.com"))
    r = client.post("/api/auth/oauth", json={"access_token": "x" * 40})
    assert r.status_code == 403 and "administrator" in r.json()["detail"]

    monkeypatch.setattr(auth, "fetch_provider_user", fake("oauth.user@example.com", confirmed=False))
    assert client.post("/api/auth/oauth", json={"access_token": "x" * 40}).status_code == 401

    monkeypatch.setattr(auth, "fetch_provider_user", fake("OAuth.User@example.com", provider="microsoft"))
    r = client.post("/api/auth/oauth", json={"access_token": "x" * 40})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    me = client.get("/api/auth/me", headers=h).json()
    assert me["signed_in_via"] == "microsoft" and me["auth_provider_label"] == "Microsoft"
    assert client.get("/api/cases", headers=h).status_code == 200


def test_oauth_user_skips_temporary_password(client, admin, monkeypatch):
    r = client.post("/api/admin/users", headers=admin, json={"full_name": "New Examiner",
                                                            "email": "fresh@example.com", "role": "examiner"})
    assert r.status_code == 200
    monkeypatch.setattr(auth, "fetch_provider_user", lambda t: {
        "email": "fresh@example.com", "verified": True, "provider": "google"})
    tok = client.post("/api/auth/oauth", json={"access_token": "y" * 40}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert not client.get("/api/auth/me", headers=h).json()["must_change_password"]
    # Study mode is on in the tests, so the research-use terms come first.
    assert client.get("/api/cases", headers=h).status_code == 403
    client.post("/api/auth/research-use/accept", headers=h)
    assert client.get("/api/cases", headers=h).status_code == 200


def test_study_mode_off_skips_research_terms(client, admin, monkeypatch):
    r = client.post("/api/admin/users", headers=admin, json={"full_name": "Real World",
                                                            "email": "real@example.com", "role": "examiner"})
    temp = r.json()["temporary_password"]
    h = login(client, "real@example.com", temp)
    client.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": "examiner123"})
    assert client.get("/api/cases", headers=h).status_code == 403
    monkeypatch.setattr(security, "STUDY_MODE", False)
    assert client.get("/api/cases", headers=h).status_code == 200


def test_guided_tour_flag(client, examiner):
    assert client.post("/api/auth/tour", headers=examiner, json={"done": True}).json()["tour_completed"]
    assert not client.post("/api/auth/tour", headers=examiner, json={"done": False}).json()["tour_completed"]
