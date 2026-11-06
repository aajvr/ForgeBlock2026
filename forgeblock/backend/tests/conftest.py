"""Shared test setup: one temporary database and app for all test modules."""
import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp())
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp / 'test.db'}"
os.environ["STORAGE_DIR"] = str(_tmp / "storage")
os.environ["WEIGHTS_DIR"] = str(_tmp / "weights")
os.environ["DEMO_MODE"] = "true"
# Study mode on, so the research-use terms (Section 3.8) are tested too.
os.environ["STUDY_MODE"] = "true"
# Clerk test keys: pk_test_ + base64("clerk.example.test$")
os.environ["CLERK_PUBLISHABLE_KEY"] = "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA"
os.environ["CLERK_SECRET_KEY"] = "sk_test_example"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256-0123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ADMIN_PW = "Admin-pass-2026"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(c, email, password):
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def admin(client):
    h = login(client, "admin@forgeblock.local", "ChangeMe123!")
    # The seeded admin must change the default password first.
    assert client.get("/api/admin/users", headers=h).status_code == 403
    r = client.post("/api/auth/change-password", headers=h,
                    json={"current_password": "ChangeMe123!", "new_password": ADMIN_PW})
    assert r.status_code == 200, r.text
    # Then the research-use terms (Section 3.8) before anything else.
    assert client.get("/api/admin/users", headers=h).status_code == 403
    assert client.post("/api/auth/research-use/accept", headers=h).status_code == 200
    assert client.get("/api/admin/users", headers=h).status_code == 200
    return h


def make_user(c, admin, email, role="examiner", **extra):
    r = c.post("/api/admin/users", headers=admin, json={"full_name": email.split("@")[0], "email": email,
                                                        "role": role, **extra})
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    h = login(c, email, temp)
    r = c.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": "examiner123"})
    assert r.status_code == 200, r.text
    assert c.post("/api/auth/research-use/accept", headers=h).status_code == 200
    return h


@pytest.fixture(scope="session")
def examiner(client, admin):
    return make_user(client, admin, "ex1@example.com")


@pytest.fixture(scope="session")
def examiner2(client, admin):
    return make_user(client, admin, "ex2@example.com")


