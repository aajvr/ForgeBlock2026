"""v8.19: bulk delete of reference signatures on the signature card."""
from test_api import _client_with_refs


def test_bulk_delete_references(client, examiner, examiner2):
    cid = _client_with_refs(client, examiner, name="Bulk Delete", n=8)
    refs = client.get(f"/api/clients/{cid}", headers=examiner).json()["static_references"]
    ids = [r["id"] for r in refs]
    other = _client_with_refs(client, examiner, name="Bulk Other", n=7)
    other_id = client.get(f"/api/clients/{other}", headers=examiner).json()["static_references"][0]["id"]

    # Another examiner cannot touch this client.
    assert client.post(f"/api/clients/{cid}/references/bulk-delete", headers=examiner2,
                       json={"ids": ids[:2]}).status_code == 404

    # Ids of another client's references are reported as failed and left alone.
    r = client.post(f"/api/clients/{cid}/references/bulk-delete", headers=examiner,
                    json={"ids": ids[:3] + [other_id, 999999]})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == ids[:3]
    assert {f["id"] for f in r.json()["failed"]} == {other_id, 999999}

    c = client.get(f"/api/clients/{cid}", headers=examiner).json()
    assert c["static_count"] == 5 and {r["id"] for r in c["static_references"]} == set(ids[3:])
    assert client.get(f"/api/clients/{other}", headers=examiner).json()["static_count"] == 7

    # Deleting the same ones again fails cleanly; single delete still works.
    assert client.post(f"/api/clients/{cid}/references/bulk-delete", headers=examiner,
                       json={"ids": ids[:1]}).json()["failed"][0]["id"] == ids[0]
    assert client.delete(f"/api/references/{ids[3]}", headers=examiner).status_code == 200
