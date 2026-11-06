"""Sign-in. There is no self-registration: admins create accounts with a
temporary password, which must be changed on first password sign-in. Users
can also sign in with Microsoft or Google through Clerk; this stays
invite-only, because the verified email must belong to an existing account.
In study mode the user accepts the research-use terms (Chapter 3, Section
3.8) before anything else is available. Accounts lock for LOCKOUT_MINUTES
after MAX_FAILED_LOGINS wrong passwords."""
import base64
import json
import urllib.error
import urllib.request
from datetime import timedelta
from functools import lru_cache

import jwt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import (
    DEV_PEN_DEVICES,
    IDLE_TIMEOUT_MINUTES,
    LOCKOUT_MINUTES,
    MAX_FAILED_LOGINS,
    CLERK_API_URL,
    CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY,
    CORS_ORIGINS,
    OAUTH_PROVIDERS,
    STUDY_MODE,
)
from ..database import get_db
from ..models import Client, User, utcnow
from ..security import (
    create_token,
    hash_password,
    user_allow_temp_password,
    user_before_research_terms,
    verify_password,
)
from ..services import log_activity, notify, staff_ids

router = APIRouter(prefix="/api/auth", tags=["auth"])

ROLE_LABELS = {"admin": "Administrator", "examiner": "Examiner", "client": "Client"}
PROVIDER_LABELS = {"password": "Email and password", "azure": "Microsoft", "microsoft": "Microsoft", "google": "Google"}

# Shown on first sign-in and in the Help Center. Wording follows Section 3.8.
RESEARCH_USE_TERMS = [
    "ForgeBlock is an academic research prototype of De La Salle University–Dasmariñas. "
    "I will use it only for the approved research activities of the ForgeBlock study.",
    "I will not use ForgeBlock to verify signatures on actual legal, financial or official documents. "
    "Its results are experimental and are not evidence of a signature's authenticity.",
    "I will use only the test accounts and signature samples prepared by the researchers, "
    "not my own or anyone else's legal signature.",
    "I will not photograph, copy, share or reproduce any signature shown in ForgeBlock. "
    "ForgeBlock has no function to download or export signature images.",
    "I can see only my own signatures and activity records. Accounts are created only by the researchers.",
]


class LoginIn(BaseModel):
    email: str
    password: str


class OAuthIn(BaseModel):
    access_token: str = Field(min_length=20, max_length=8000)


class TourIn(BaseModel):
    done: bool = True


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


def user_out(u: User, db: Session | None = None) -> dict:
    via = getattr(u, "signed_in_via", u.auth_provider or "password")
    out = {
        "id": u.id,
        "full_name": u.full_name,
        "email": u.email,
        "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role),
        "status": u.status,
        "account_code": u.account_code,
        # A temporary password must be changed only when it was used to sign in.
        "must_change_password": u.must_change_password and via == "password",
        "signed_in_via": via,
        "auth_provider": u.auth_provider,
        "auth_provider_label": PROVIDER_LABELS.get(u.auth_provider or "password", u.auth_provider),
        "tour_completed": u.tour_completed_at is not None,
        "study_mode": STUDY_MODE,
        "research_use_accepted": u.research_use_accepted_at is not None,
        "research_use_accepted_at": u.research_use_accepted_at,
        "is_test_account": u.is_test_account,
        # Development pens without tilt accepted (DEV_PEN_DEVICES); shown in the UI.
        "dev_pen_devices": DEV_PEN_DEVICES,
        "locked": bool(u.locked_until and u.locked_until > utcnow()),
        "client_id": u.client_id,
        "created_at": u.created_at,
        "last_login": u.last_login,
    }
    if db is not None and u.client_id:
        c = db.get(Client, u.client_id)
        out["client_code"] = c.client_code if c else None
    out["group_id"] = u.group_id
    out["group_name"] = None
    if db is not None and u.group_id:
        from ..models import ClientGroup
        g = db.get(ClientGroup, u.group_id)
        out["group_name"] = g.name if g else None
    return out


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    now = utcnow()
    if user is not None and user.locked_until and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(423, f"Too many failed attempts. This account is locked for {minutes} more minute(s).")
    if user is None or not verify_password(body.password, user.password_hash):
        if user is not None:
            user.failed_logins += 1
            left = MAX_FAILED_LOGINS - user.failed_logins
            if left <= 0:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_logins = 0
                db.commit()
                log_activity(db, user, "lockout", f"Account locked after {MAX_FAILED_LOGINS} failed sign-in attempts")
                notify(db, staff_ids(db, "admin"), f"{user.full_name}'s account was locked after failed sign-ins.",
                       "/app/admin/users")
                raise HTTPException(423, f"Too many failed attempts. This account is locked for {LOCKOUT_MINUTES} minutes.")
            db.commit()
            log_activity(db, user, "login_failed", "Failed sign-in attempt")
            raise HTTPException(401, f"Incorrect email or password. {left} attempt(s) left before the account locks.")
        raise HTTPException(401, "Incorrect email or password.")
    if user.status != "active":
        raise HTTPException(403, "This account has been disabled. Contact an administrator.")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login = now
    user.last_seen = now
    user.auth_provider = "password"
    db.commit()
    user.signed_in_via = "password"
    log_activity(db, user, "login", "Signed in")
    return {"token": create_token(user), "user": user_out(user, db), "idle_timeout_minutes": IDLE_TIMEOUT_MINUTES}


# ------------------------------------------------- Microsoft / Google ---

def clerk_frontend_api() -> str | None:
    """The Clerk Frontend API host, which is encoded in the publishable key
    (pk_test_<base64 of "host$">)."""
    try:
        prefix, _env, enc = CLERK_PUBLISHABLE_KEY.split("_", 2)
        if prefix != "pk":
            return None
        host = base64.b64decode(enc + "=" * (-len(enc) % 4)).decode().rstrip("$")
        return host if host and "/" not in host and "." in host else None
    except (ValueError, UnicodeDecodeError):
        return None


def oauth_enabled() -> bool:
    return bool(CLERK_SECRET_KEY and clerk_frontend_api() and OAUTH_PROVIDERS)


@router.get("/providers")
def sign_in_providers():
    """Public: which sign-in buttons the sign-in page shows."""
    on = oauth_enabled()
    return {"enabled": on, "providers": OAUTH_PROVIDERS if on else [],
            "clerk_publishable_key": CLERK_PUBLISHABLE_KEY if on else None,
            "clerk_frontend_api": clerk_frontend_api() if on else None, "study_mode": STUDY_MODE}


_SIGN_IN_FAILED = "The Microsoft or Google sign-in has expired or is not valid. Please try again."
_UNREACHABLE = "Could not reach the sign-in service. Please try again."


@lru_cache(maxsize=4)
def _jwks_client(host: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{host}/.well-known/jwks.json", cache_keys=True)


def verify_clerk_token(token: str) -> dict:
    """Checks the Clerk session token: RS256 signature against Clerk's public
    keys, issuer, expiry and (when CORS_ORIGINS is set) the authorized party."""
    host = clerk_frontend_api()
    try:
        key = _jwks_client(host).get_signing_key_from_jwt(token)
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(502, _UNREACHABLE)
    except jwt.PyJWTError:
        raise HTTPException(401, _SIGN_IN_FAILED)
    try:
        claims = jwt.decode(token, key.key, algorithms=["RS256"], issuer=f"https://{host}", leeway=10,
                            options={"require": ["exp", "iat", "iss", "sub"]})
    except jwt.PyJWTError:
        raise HTTPException(401, _SIGN_IN_FAILED)
    azp = claims.get("azp")
    if azp and "*" not in CORS_ORIGINS and azp.rstrip("/") not in [o.rstrip("/") for o in CORS_ORIGINS]:
        raise HTTPException(401, _SIGN_IN_FAILED)
    return claims


def _clerk_api(path: str) -> dict:
    req = urllib.request.Request(f"{CLERK_API_URL}{path}", headers={
        "Authorization": f"Bearer {CLERK_SECRET_KEY}", "User-Agent": "ForgeBlock"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            raise HTTPException(401, _SIGN_IN_FAILED)
        raise HTTPException(502, _UNREACHABLE)
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise HTTPException(502, _UNREACHABLE)


def fetch_provider_user(token: str) -> dict:
    """Who signed in: {email, verified, provider}. The token is verified
    locally; the email and its verification come from Clerk's Backend API."""
    claims = verify_clerk_token(token)
    u = _clerk_api(f"/users/{claims['sub']}")
    emails = u.get("email_addresses") or []
    primary = next((e for e in emails if e.get("id") == u.get("primary_email_address_id")), emails[0] if emails else {})
    email = (primary.get("email_address") or "").strip().lower()
    verified = (primary.get("verification") or {}).get("status") == "verified"
    accounts = u.get("external_accounts") or []
    acct = next((a for a in accounts if (a.get("email_address") or "").strip().lower() == email),
                accounts[0] if accounts else {})
    provider = (acct.get("provider") or "").removeprefix("oauth_") or "oauth"
    return {"email": email, "verified": verified, "provider": provider}


@router.post("/oauth")
def oauth_login(body: OAuthIn, db: Session = Depends(get_db)):
    """Completes a Microsoft or Google sign-in. Invite-only: the verified email
    must belong to an active ForgeBlock account created by an admin."""
    if not oauth_enabled():
        raise HTTPException(404, "Microsoft and Google sign-in are not set up.")
    info = fetch_provider_user(body.access_token)
    email = (info.get("email") or "").strip().lower()
    provider = info.get("provider") or "oauth"
    if not email or not info.get("verified"):
        raise HTTPException(401, "This Microsoft or Google account has no verified email address.")
    if provider not in OAUTH_PROVIDERS:
        raise HTTPException(403, "This sign-in method is not allowed.")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise HTTPException(403, f"No ForgeBlock account uses {email}. Accounts are created by your administrator; "
                                 "ask them to register this email.")
    now = utcnow()
    if user.locked_until and user.locked_until > now:
        raise HTTPException(423, "This account is locked for a few minutes after failed sign-ins.")
    if user.status != "active":
        raise HTTPException(403, "This account has been disabled. Contact an administrator.")
    user.failed_logins = 0
    user.last_login = now
    user.last_seen = now
    user.auth_provider = provider
    db.commit()
    user.signed_in_via = provider
    log_activity(db, user, "login", f"Signed in with {PROVIDER_LABELS.get(provider, provider)}")
    return {"token": create_token(user, via=provider), "user": user_out(user, db),
            "idle_timeout_minutes": IDLE_TIMEOUT_MINUTES}


@router.post("/tour")
def tour_done(body: TourIn, db: Session = Depends(get_db), user: User = Depends(user_allow_temp_password)):
    """Marks the first-time guided tour as finished (or skipped)."""
    user.tour_completed_at = utcnow() if body.done else None
    db.commit()
    return user_out(user, db)


@router.get("/me")
def me(db: Session = Depends(get_db), user: User = Depends(user_allow_temp_password)):
    return {**user_out(user, db), "idle_timeout_minutes": IDLE_TIMEOUT_MINUTES}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, db: Session = Depends(get_db),
                    user: User = Depends(user_allow_temp_password)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "The current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(422, "Choose a new password that is different from the current one.")
    if body.new_password.isalpha() or body.new_password.isdigit():
        raise HTTPException(422, "Use a mix of letters and numbers.")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    user.signed_in_via = "password"
    log_activity(db, user, "password", "Changed password")
    return user_out(user, db)


@router.get("/research-use")
def research_use_terms():
    return {"terms": RESEARCH_USE_TERMS, "required": STUDY_MODE}


@router.post("/research-use/accept")
def accept_research_use(db: Session = Depends(get_db), user: User = Depends(user_before_research_terms)):
    if user.research_use_accepted_at is None:
        user.research_use_accepted_at = utcnow()
        db.commit()
        log_activity(db, user, "account", "Accepted the research-use terms")
    return user_out(user, db)
