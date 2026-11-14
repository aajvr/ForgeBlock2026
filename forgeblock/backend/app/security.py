import secrets
import string
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import IDLE_TIMEOUT_MINUTES, JWT_EXPIRE_MINUTES, JWT_SECRET, STUDY_MODE
from .database import get_db
from .models import User, utcnow

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def temporary_password() -> str:
    """A readable temporary password, e.g. 'Kx7m-Q2pa-9TzR'."""
    alphabet = string.ascii_letters + string.digits
    alphabet = "".join(c for c in alphabet if c not in "0OIl1")
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


def create_token(user: User, via: str = "password") -> str:
    """via: how the user signed in (password, azure or google)."""
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "via": via,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def _user_from_token(creds: HTTPAuthorizationCredentials | None, db: Session) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.")
    user = db.get(User, int(payload["sub"]))
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account is not active.")
    now = utcnow()
    # Idle sign-out: a session unused for IDLE_TIMEOUT_MINUTES is ended on the
    # server too, not only by the browser's timer.
    if user.last_seen and now - user.last_seen > timedelta(minutes=IDLE_TIMEOUT_MINUTES):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"You were signed out after {IDLE_TIMEOUT_MINUTES} minutes without activity.",
        )
    user.last_seen = now
    db.commit()
    # Not stored: how this session signed in. A Microsoft or Google sign-in
    # does not use the temporary password, so it need not be changed.
    user.signed_in_via = payload.get("via", "password")
    return user


def user_allow_temp_password(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Signed-in user, even if they still have to change a temporary password."""
    return _user_from_token(creds, db)


def user_before_research_terms(user: User = Depends(user_allow_temp_password)) -> User:
    """Signed-in user with a changed password who may not yet have accepted
    the research-use terms."""
    if user.must_change_password and getattr(user, "signed_in_via", "password") == "password":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please change your temporary password first.")
    return user


def current_user(user: User = Depends(user_before_research_terms)) -> User:
    # The research-use terms are required in study mode only (Section 3.8).
    if STUDY_MODE and user.research_use_accepted_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please read and accept the research-use terms first.")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this page.")
        return user

    return dep


require_admin = require_roles("admin")
require_staff = require_roles("admin", "examiner")


def require_result_viewer(user: User = Depends(current_user)) -> User:
    """v8.24: staff, and clients when CLIENT_FULL_RESULTS is on. The record-level
    check (app/access.py) still limits a client to their own screenings."""
    from .config import CLIENT_FULL_RESULTS

    if user.role in ("admin", "examiner") or (user.role == "client" and CLIENT_FULL_RESULTS):
        return user
    raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this page.")
