"""Clerk sign-in: the session token is verified locally (RS256, issuer,
expiry, authorized party) and the email comes from Clerk's Backend API."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.routers import auth
from conftest import make_user

ISS = "https://clerk.example.test"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _Key:
    def __init__(self, k):
        self.key = k.public_key()


class _Jwks:
    def get_signing_key_from_jwt(self, token):
        return _Key(KEY)


def _token(key=KEY, **over):
    now = int(time.time())
    claims = {"iss": ISS, "sub": "user_123", "iat": now, "exp": now + 60, "azp": "http://localhost:5173", **over}
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def clerk(monkeypatch):
    monkeypatch.setattr(auth, "_jwks_client", lambda host: _Jwks())
    user = {"primary_email_address_id": "e1",
            "email_addresses": [{"id": "e1", "email_address": "Clerk.User@example.com",
                                 "verification": {"status": "verified"}}],
            "external_accounts": [{"provider": "oauth_google", "email_address": "clerk.user@example.com"}]}
    monkeypatch.setattr(auth, "_clerk_api", lambda path: user)
    return user


def test_providers_expose_clerk(client):
    p = client.get("/api/auth/providers").json()
    assert p["enabled"] and p["clerk_frontend_api"] == "clerk.example.test"
    assert p["providers"] == ["google", "microsoft"] and p["clerk_publishable_key"].startswith("pk_test_")


def test_valid_clerk_token(clerk):
    assert auth.fetch_provider_user(_token()) == {"email": "clerk.user@example.com", "verified": True, "provider": "google"}


@pytest.mark.parametrize("bad", [
    {"key": OTHER},                                  # forged signature
    {"exp": int(time.time()) - 120},                 # expired
    {"iss": "https://evil.example"},                 # wrong issuer
    {"azp": "https://evil.example"},                 # another site's token
])
def test_bad_clerk_tokens_are_refused(clerk, bad):
    key = bad.pop("key", KEY)
    with pytest.raises(HTTPException) as e:
        auth.verify_clerk_token(_token(key, **bad))
    assert e.value.status_code == 401


def test_clerk_sign_in_end_to_end(client, admin, clerk):
    make_user(client, admin, "clerk.user@example.com")
    r = client.post("/api/auth/oauth", json={"access_token": _token()})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "clerk.user@example.com"
    clerk["email_addresses"][0]["verification"]["status"] = "unverified"
    assert client.post("/api/auth/oauth", json={"access_token": _token()}).status_code == 401
