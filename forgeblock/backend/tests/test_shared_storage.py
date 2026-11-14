"""v8.24: signature files are shared through Supabase Storage (faked here)."""
import httpx
import numpy as np

from app import remote_storage, services


def _fake_bucket(monkeypatch):
    store: dict[str, bytes] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/storage/v1/bucket/forgeblock-samples"):
            return httpx.Response(200, json={"id": "forgeblock-samples"})
        prefix = "/storage/v1/object/forgeblock-samples/"
        if req.method == "POST" and path.startswith(prefix):
            key = path[len(prefix):]
            if key in store and req.headers.get("x-upsert") == "false":
                return httpx.Response(409, json={"error": "Duplicate", "message": "The resource already exists"})
            store[key] = req.content
            return httpx.Response(200, json={"Key": key})
        if req.method == "GET" and path.startswith(prefix):
            key = path[len(prefix):]
            return httpx.Response(200, content=store[key]) if key in store else httpx.Response(400, json={"error": "not_found"})
        if req.method == "DELETE" and path.endswith("/storage/v1/object/forgeblock-samples"):
            import json
            for k in json.loads(req.content)["prefixes"]:
                store.pop(k, None)
            return httpx.Response(200, json=[])
        return httpx.Response(404)

    monkeypatch.setattr(remote_storage, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(remote_storage, "SUPABASE_SERVICE_KEY", "sb_secret_test")
    monkeypatch.setattr(remote_storage, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(remote_storage, "_bucket_ready", False)
    remote_storage._misses.clear()
    return store


def test_file_saved_on_one_pc_is_read_on_another(monkeypatch):
    store = _fake_bucket(monkeypatch)
    img = np.full((40, 80, 3), 255, np.uint8)
    img[18:22, 10:70] = 0
    rel = services.save_image(img, "test-shared")
    assert rel in store  # uploaded
    local = services.storage_path(rel)
    local.unlink()  # "another computer" has no local copy
    got = services.load_image(rel)
    assert got is not None and got.shape == img.shape  # fetched from the bucket
    strokes_rel = services.save_strokes([[{"x": 1, "y": 2}]], "test-shared")
    assert strokes_rel in store
    services.delete_file(rel)
    assert rel not in store and services.storage_path(rel) is None


def test_storage_is_local_only_without_keys(monkeypatch):
    monkeypatch.setattr(remote_storage, "SUPABASE_URL", "")
    assert not remote_storage.enabled()
    rel = services.save_image(np.zeros((10, 10, 3), np.uint8), "test-local")
    assert services.storage_path(rel) is not None
