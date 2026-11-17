"""v8.26: feature gate on static Consistent results."""
from app.ml.screening import FEATURE_GATE_MAX, feature_gate


def test_feature_gate_only_downgrades_consistent():
    assert feature_gate("consistent", FEATURE_GATE_MAX) == "consistent"
    assert feature_gate("consistent", FEATURE_GATE_MAX + 1) == "inconclusive"
    assert feature_gate("inconsistent", 9) == "inconsistent"
    assert feature_gate("inconclusive", 9) == "inconclusive"


def test_feature_gate_setting(client, admin, examiner):
    put = lambda h, body: client.put("/api/admin/settings/screening", headers=h, json=body)
    s = client.get("/api/admin/settings", headers=admin).json()["screening"]
    assert s["feature_gate"] is True and s["size_mode"] == "always"
    assert put(examiner, {"feature_gate": False}).status_code == 403
    try:
        v = put(admin, {"feature_gate": False}).json()
        assert v["feature_gate"] is False and v["size_mode"] == "always"
        assert "feature gate off" in client.get("/api/admin/audit", headers=admin).text
    finally:
        put(admin, {"feature_gate": True})
