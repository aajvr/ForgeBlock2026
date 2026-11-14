"""v8: client groups (one examiner per group, no overlap), client accounts
created at registration, the client's limited screening view, and the
writer-dependent confidence score."""
import numpy as np
import pytest
from conftest import login, make_user
from test_api import _client_with_refs, signature_png

from app.ml import decision as dec


def _group(client, admin, name, examiner_id=None):
    r = client.post("/api/groups", headers=admin, json={"name": name, "examiner_id": examiner_id})
    assert r.status_code == 200, r.text
    return r.json()


def _me(client, h):
    return client.get("/api/auth/me", headers=h).json()


def test_groups_isolate_examiners(client, admin):
    law = make_user(client, admin, "law@example.com")
    oss = make_user(client, admin, "oss@example.com")
    g_law = _group(client, admin, "Lawyers", _me(client, law)["id"])
    g_oss = _group(client, admin, "OSS", _me(client, oss)["id"])
    assert g_law["examiner"]["id"] == _me(client, law)["id"]

    # An examiner handles one group only.
    r = client.patch(f"/api/groups/{g_oss['id']}", headers=admin, json={"examiner_id": _me(client, law)["id"]})
    assert r.status_code == 409

    # Clients an examiner registers go into their group.
    cid = _client_with_refs(client, law, "Atty Cruz")
    card = client.get(f"/api/clients/{cid}", headers=law).json()
    assert card["group_name"] == "Lawyers" and card["assigned_examiner"]["id"] == _me(client, law)["id"]

    # The other group's examiner cannot see, search or screen that client.
    assert client.get(f"/api/clients/{cid}", headers=oss).status_code == 404
    assert all(c["id"] != cid for c in client.get("/api/clients", headers=oss).json())
    assert client.get("/api/search?q=Atty", headers=oss).json()["clients"] == []
    r = client.post("/api/screen/static", headers=oss, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(5), "image/png")})
    assert r.status_code == 404

    # A screening on a group client: visible to the group's examiner only.
    r = client.post("/api/screen/static", headers=law, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(31), "image/png")})
    log_id = r.json()["id"]
    assert client.get(f"/api/verifications/{log_id}", headers=oss).status_code == 404

    # The admin moves the client to OSS: now only OSS sees it, with its history.
    assert client.patch(f"/api/clients/{cid}", headers=admin, json={"group_id": g_oss["id"]}).status_code == 200
    assert client.get(f"/api/clients/{cid}", headers=law).status_code == 404
    assert client.get(f"/api/clients/{cid}", headers=oss).status_code == 200
    assert client.get(f"/api/verifications/{log_id}", headers=oss).status_code == 200
    # Examiners cannot move clients.
    assert client.patch(f"/api/clients/{cid}", headers=oss, json={"group_id": g_law["id"]}).status_code == 403

    # Examiners see only their own group in the list; admins see all.
    assert [g["name"] for g in client.get("/api/groups", headers=oss).json()["groups"]] == ["OSS"]
    names = [g["name"] for g in client.get("/api/groups", headers=admin).json()["groups"]]
    assert {"Lawyers", "OSS"} <= set(names)
    # A group with clients cannot be deleted.
    assert client.delete(f"/api/groups/{g_oss['id']}", headers=admin).status_code == 409


def test_client_account_created_at_registration_and_limited_view(client, admin):
    ex = make_user(client, admin, "ccje@example.com")
    _group(client, admin, "CCJE", _me(client, ex)["id"])
    r = client.post("/api/clients", headers=ex, json={"full_name": "Prof Reyes", "email": "prof@example.com"})
    assert r.status_code == 200, r.text
    acct = r.json()["new_account"]
    assert acct["email"] == "prof@example.com" and acct["temporary_password"]
    cid = r.json()["id"]
    # The same email cannot be used twice.
    assert client.post("/api/clients", headers=ex, json={"email": "prof@example.com"}).status_code == 409

    # Give the client references and screen once.
    files = [("files", (f"s{i}.png", signature_png(1, jitter=0.6 + 0.1 * i), "image/png")) for i in range(5)]
    assert client.post(f"/api/clients/{cid}/static/enroll", headers=ex, files=files).status_code == 200
    r = client.post("/api/screen/static", headers=ex, data={"client_id": str(cid)},
                    files={"file": ("q.png", signature_png(1, jitter=0.95), "image/png")})
    log_id = r.json()["id"]

    # The client signs in, sees the assigned examiner and opens the screening.
    h = login(client, "prof@example.com", acct["temporary_password"])
    client.post("/api/auth/change-password", headers=h,
                json={"current_password": acct["temporary_password"], "new_password": "client123x"})
    client.post("/api/auth/research-use/accept", headers=h)
    me = client.get("/api/me/client", headers=h).json()
    assert me["assigned_examiner"]["full_name"] == "ccje" and me["checks"][0]["examiner_name"] == "ccje"
    detail = client.get(f"/api/verifications/{log_id}", headers=h).json()
    assert detail["screening_result"] and "confidence_score" in detail and detail["block"]
    # v8.24: full read-only result for the client by default ...
    for shown in ("metrics", "thresholds", "analysis", "votes"):
        assert shown in detail, shown
    # ... and the old limited view when CLIENT_FULL_RESULTS=false.
    import app.config as cfg
    import app.routers.verification as ver
    old = (cfg.CLIENT_FULL_RESULTS, ver.CLIENT_FULL_RESULTS)
    cfg.CLIENT_FULL_RESULTS = ver.CLIENT_FULL_RESULTS = False
    try:
        detail = client.get(f"/api/verifications/{log_id}", headers=h).json()
        for hidden in ("metrics", "thresholds", "analysis", "votes", "similarity_score"):
            assert hidden not in detail, hidden
        assert client.get(f"/api/verifications/{log_id}/image", headers=h).status_code == 403
    finally:
        cfg.CLIENT_FULL_RESULTS, ver.CLIENT_FULL_RESULTS = old


def test_writer_dependent_confidence():
    rng = np.random.default_rng(0)
    base = rng.normal(size=64)
    base /= np.linalg.norm(base)
    refs = []
    for _ in range(8):
        v = base + rng.normal(scale=0.035, size=64)
        refs.append(v / np.linalg.norm(v))
    cfg = {"thresholds": {"cosine": 0.85, "euclidean": 0.55, "manhattan": 4.0},
           "bounds": {"cosine": [0.80, 0.97], "euclidean": [0.25, 0.63], "manhattan": [1.0, 8.0]}}
    # A reference screened against its own set: high confidence, flagged as an exact match.
    d = dec.screen_static_embedding(refs[3], refs, cfg, min_adaptive=7)
    assert d.classification == "genuine" and d.confidence >= 90, d.confidence
    assert dec.exact_match_index(refs[3], refs) == 3
    # A new genuine-like sample: clearly past the line (old scale gave ~30%).
    v = base + rng.normal(scale=0.035, size=64)
    d = dec.screen_static_embedding(v / np.linalg.norm(v), refs, cfg, min_adaptive=7)
    assert d.classification == "genuine" and d.confidence >= 50, d.confidence
    # A different signer: forged side.
    other = rng.normal(size=64)
    d = dec.screen_static_embedding(other / np.linalg.norm(other), refs, cfg, min_adaptive=7)
    assert d.classification == "forged" and d.confidence >= 50

    table = dec.error_reject_table([5, 15, 40, 80, 90], [False, True, True, True, True], bands=[0, 10, 20])
    assert table[0]["error_rate"] == 0.2 and table[1]["error_rate"] == 0.0
    assert dec.suggest_band(table, max_error=0.05)["band"] == 10


def test_confidence_has_variance_and_never_claims_certainty():
    """v8.2: z-score confidence. Genuine samples spread out instead of all
    saturating at 100, and no result ever reaches 100."""
    rng = np.random.default_rng(1)
    base = rng.normal(size=64)
    base /= np.linalg.norm(base)

    def sample(scale):
        v = base + rng.normal(scale=scale, size=64)
        return v / np.linalg.norm(v)

    refs = [sample(0.035) for _ in range(10)]
    cfg = {"thresholds": {"cosine": 0.85, "euclidean": 0.55, "manhattan": 4.0},
           "bounds": {"cosine": [0.50, 0.995], "euclidean": [0.05, 0.9], "manhattan": [0.5, 9.0]}}
    genuine = [dec.screen_static_embedding(sample(0.035), refs, cfg, 5).confidence for _ in range(40)]
    assert max(genuine) <= dec.CONFIDENCE_CAP
    assert np.std(genuine) > 5, genuine  # not all the same
    assert sum(c >= 98.9 for c in genuine) < len(genuine) / 2, genuine  # not mostly at the cap
    # A signature as close as the client's typical one lands around 87%.
    assert 2 * dec._phi(1.5) - 1 == pytest.approx(0.866, abs=0.01)
    # On the threshold: 0.
    assert dec._confidence([0.0, 0.0, 0.0], True) == 0.0
    # Same-side metrics only: a metric on the other side adds 0.
    assert dec._confidence([3.0, -3.0, 3.0], True) == pytest.approx(2 / 3 * 99.73, abs=0.1)
