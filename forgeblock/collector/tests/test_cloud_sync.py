"""Supabase Storage mirror, tested against a small fake of the Storage REST API."""
import math
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

STORE: dict[str, bytes] = {}
BUCKETS: set[str] = set()
fake = FastAPI()


def auth(apikey: str):
    if apikey != "sb_secret_test":
        raise HTTPException(401)


@fake.get("/storage/v1/bucket/{b}")
def get_bucket(b: str, apikey: str = Header("")):
    auth(apikey)
    if b not in BUCKETS:
        raise HTTPException(404)
    return {"id": b}


@fake.post("/storage/v1/bucket")
async def make_bucket(request: Request, apikey: str = Header("")):
    auth(apikey)
    body = await request.json()
    assert body["public"] is False
    BUCKETS.add(body["id"])
    return {"name": body["id"]}


@fake.post("/storage/v1/object/list/{b}")
async def list_objects(b: str, request: Request, apikey: str = Header("")):
    auth(apikey)
    prefix = (await request.json())["prefix"]
    files, folders = [], set()
    for k in STORE:
        if k.startswith(prefix):
            rest = k[len(prefix):]
            if "/" in rest:
                folders.add(rest.split("/")[0])
            else:
                files.append({"name": rest, "id": "x"})
    return [{"name": f, "id": None} for f in sorted(folders)] + files


@fake.post("/storage/v1/object/{b}/{path:path}")
async def upload(b: str, path: str, request: Request, apikey: str = Header(""), x_upsert: str = Header("")):
    auth(apikey)
    assert x_upsert == "true"
    STORE[path] = await request.body()
    return {"Key": path}


@fake.get("/storage/v1/object/{b}/{path:path}")
def download(b: str, path: str, apikey: str = Header("")):
    auth(apikey)
    if path not in STORE:
        raise HTTPException(404)
    return Response(STORE[path])


@fake.delete("/storage/v1/object/{b}")
async def delete(b: str, request: Request, apikey: str = Header("")):
    auth(apikey)
    for k in (await request.json())["prefixes"]:
        STORE.pop(k, None)
    return []


@pytest.fixture(scope="module")
def fake_url():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    server = uvicorn.Server(uvicorn.Config(fake, host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    while not server.started:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True


def boot(tmp: Path, url: str, monkeypatch):
    monkeypatch.setenv("COLLECTOR_KEY", "test-key")
    monkeypatch.setenv("COLLECTOR_DATA", str(tmp))
    monkeypatch.setenv("SUPABASE_URL", url)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    for m in ("app", "sheets", "cloud_sync"):
        sys.modules.pop(m, None)
    import app as collector
    from fastapi.testclient import TestClient

    c = TestClient(collector.app)
    c.headers["X-Collector-Key"] = "test-key"
    return c


def strokes(n=60):
    return [{"x": 50 + i * 4, "y": 150 + 30 * math.sin(i / 5), "t": 1000 + i * 8, "pen": 1, "azimuth": 45, "altitude": 60, "pressure": 0.5} for i in range(n)]


def test_mirror_and_restore(tmp_path, fake_url, monkeypatch):
    c = boot(tmp_path / "a", fake_url, monkeypatch)
    assert "collector-data" in BUCKETS
    assert c.post("/api/sessions", json={"code": "P001", "consent": True, "researcher": "R"}).status_code == 200
    assert c.post("/api/sessions/P001/dynamic", json={"kind": "genuine", "points": strokes(), "height": 300}).status_code == 200
    assert {"participants/P001/session.json", "dynamic/U1S1.TXT", "dynamic/meta/U1S1.json"} <= set(STORE)

    # A fresh, empty disk (as after the free host sleeps) gets everything back.
    c2 = boot(tmp_path / "b", fake_url, monkeypatch)
    s = c2.get("/api/sessions/P001").json()
    assert s["progress"]["dynamic_genuine"] == 1
    assert (tmp_path / "b" / "dynamic" / "U1S1.TXT").read_bytes() == STORE["dynamic/U1S1.TXT"]

    # Deletes are mirrored too.
    assert c2.delete("/api/sessions/P001/dynamic/last?kind=genuine").status_code == 200
    assert "dynamic/U1S1.TXT" not in STORE
    c2.post("/api/sessions/P001/withdraw")
    assert not any(k.startswith("dynamic/") for k in STORE)


def test_refuses_to_start_without_storage(tmp_path, monkeypatch):
    with pytest.raises(Exception) as e:
        boot(tmp_path, "http://127.0.0.1:9", monkeypatch)
    assert type(e.value).__name__ == "SyncError"
