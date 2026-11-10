"""Admin pages: dashboard, users and roles, groups, audit log,
data retention, system status and the model."""
import shutil
from collections import Counter
from datetime import timedelta

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import may_be_admin
from ..config import (
    DATABASE_URL,
    STUDY_MODE,
    IDLE_TIMEOUT_MINUTES,
    LOCKOUT_MINUTES,
    MAX_FAILED_LOGINS,
    RESEARCH_TEAM_EMAILS,
    STORAGE_DIR,
    WEIGHTS_DIR,
)
from ..database import get_db
from ..ledger import chain_height, last_auto_check, validate_chain
from ..models import (
    ActivityLog,
    Case,
    Client,
    ClientAccess,
    Finding,
    SignatureProfile,
    User,
    VerificationLog,
    utcnow,
)
from ..security import hash_password, require_admin, temporary_password
from ..services import get_setting, load_strokes, log_activity, set_setting
from .auth import user_out
from .clients import delete_client_data
from . import pen_data
from .common import client_out, get_client_or_404, log_out, names

router = APIRouter(prefix="/api/admin", tags=["admin"])

ROLES = ("admin", "examiner", "client")
ROLE_PREFIX = {"admin": "ADM", "examiner": "EX", "client": "CLU"}


def _count(db: Session, model, *where) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


# -------------------------------------------------------------- dashboard ---

@router.get("/dashboard")
def dashboard(days: int = Query(14, ge=7, le=90), db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    since = utcnow() - timedelta(days=days)
    logs = db.scalars(select(VerificationLog).where(VerificationLog.created_at >= since)).all()
    all_logs = _count(db, VerificationLog)
    per_day = Counter(l.created_at.date().isoformat() for l in logs)
    start = since.date()
    series = []
    for i in range(days + 1):
        d = (start + timedelta(days=i)).isoformat()
        day_logs = [l for l in logs if l.created_at.date().isoformat() == d]
        series.append({"date": d, "total": per_day.get(d, 0),
                       **{r: sum(l.screening_result == r for l in day_logs)
                          for r in ("consistent", "inconclusive", "inconsistent")}})
    nm = names(db)
    workload = Counter(l.performed_by for l in logs)
    return {
        "totals": {
            "clients": _count(db, Client, Client.status == "active"),
            "open_cases": _count(db, Case, Case.status == "open"),
            "screenings": all_logs,
            "examiners": _count(db, User, User.role == "examiner", User.status == "active"),
            "chain_height": chain_height(db),
        },
        "results": {r: sum(l.screening_result == r for l in logs) for r in ("consistent", "inconclusive", "inconsistent")},
        "by_modality": {m: sum(l.modality == m for l in logs) for m in ("static", "dynamic")},
        "average_confidence": round(float(np.mean([l.confidence_score for l in logs])), 1) if logs else None,
        "series": series,
        "workload": [{"name": nm.get(uid, "?"), "count": n} for uid, n in workload.most_common(8)],
        "ledger": last_auto_check(),
        "deletion_requests": _count(db, Client, Client.deletion_requested.is_(True), Client.status == "active"),
    }


# ------------------------------------------------------------------ users ---

class UserIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=160)
    role: str = Field(pattern="^(admin|examiner|client)$")
    account_code: str | None = Field(None, max_length=20)
    client_id: int | None = None


class UserUpdate(BaseModel):
    role: str | None = None
    status: str | None = None
    client_id: int | None = None


class BulkIn(BaseModel):
    prefix: str = Field("EVAL", pattern="^[A-Z]{2,8}$")
    start: int = Field(1, ge=1, le=999)
    count: int = Field(10, ge=1, le=100)
    email_domain: str = Field("forgeblock.local", max_length=80)


def _next_account_code(db: Session, role: str) -> str:
    prefix = ROLE_PREFIX[role]
    n = _count(db, User, User.account_code.like(f"{prefix}-%"))
    while True:
        n += 1
        code = f"{prefix}-{n:03d}"
        if not db.scalar(select(User.id).where(User.account_code == code)):
            return code


@router.get("/users")
def list_users(q: str | None = None, role: str | None = None, db: Session = Depends(get_db),
               admin: User = Depends(require_admin)):
    stmt = select(User).order_by(User.id)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.email).like(like),
                              func.lower(User.account_code).like(like)))
    return [user_out(u, db) for u in db.scalars(stmt)]


@router.post("/users")
def create_user(body: UserIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    if body.role == "admin" and not may_be_admin(email, body.account_code):
        raise HTTPException(403, "Administrator access is limited to the research team. Add this email to "
                                 "RESEARCH_TEAM_EMAILS on the server first.")
    if body.role == "client":
        if not body.client_id:
            raise HTTPException(422, "Choose the client record this account belongs to.")
        get_client_or_404(db, body.client_id)
    code = (body.account_code or "").strip().upper() or _next_account_code(db, body.role)
    if db.scalar(select(User).where(User.account_code == code)):
        raise HTTPException(409, f"The account code {code} is already used.")
    temp = temporary_password()
    u = User(full_name=body.full_name.strip(), email=email, role=body.role, account_code=code,
             password_hash=hash_password(temp), must_change_password=True,
             client_id=body.client_id if body.role == "client" else None)
    db.add(u)
    db.commit()
    db.refresh(u)
    log_activity(db, admin, "account", f"Created {body.role} account {code} ({email})")
    return {**user_out(u, db), "temporary_password": temp}


@router.post("/users/bulk")
def bulk_create(body: BulkIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Creates numbered test examiner accounts (e.g. EVAL-01 to EVAL-50) for
    evaluation respondents. Returns the temporary passwords once."""
    created, skipped = [], []
    width = 2 if body.start + body.count - 1 < 100 else 3
    for n in range(body.start, body.start + body.count):
        code = f"{body.prefix}-{n:0{width}d}"
        email = f"{code.lower()}@{body.email_domain}"
        if db.scalar(select(User).where(or_(User.account_code == code, User.email == email))):
            skipped.append(code)
            continue
        temp = temporary_password()
        db.add(User(full_name=f"Test examiner {code}", email=email, role="examiner", account_code=code,
                    password_hash=hash_password(temp), must_change_password=True, is_test_account=True))
        created.append({"account_code": code, "email": email, "temporary_password": temp})
    db.commit()
    log_activity(db, admin, "account", f"Created {len(created)} test examiner accounts ({body.prefix})")
    return {"created": created, "skipped": skipped}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found.")
    if u.id == admin.id and (body.status == "disabled" or (body.role and body.role != "admin")):
        raise HTTPException(400, "You cannot disable or demote your own account.")
    changes = []
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, "Role must be admin, examiner or client.")
        if body.role == "admin" and (u.is_test_account or not may_be_admin(u.email, u.account_code)):
            raise HTTPException(403, "Administrator access is limited to the research team. Add this email to "
                                     "RESEARCH_TEAM_EMAILS on the server first.")
        u.role = body.role
        if body.role != "examiner":
            u.group_id = None  # only examiners handle a client group
        changes.append(f"role {body.role}")
    if body.status is not None:
        if body.status not in ("active", "disabled"):
            raise HTTPException(422, "Status must be active or disabled.")
        u.status = body.status
        changes.append(body.status)
    if body.client_id is not None:
        get_client_or_404(db, body.client_id)
        u.client_id = body.client_id
        changes.append("linked client")
    db.commit()
    log_activity(db, admin, "account", f"Updated {u.account_code or u.email}: {', '.join(changes) or 'no change'}")
    return user_out(u, db)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found.")
    temp = temporary_password()
    u.password_hash = hash_password(temp)
    u.must_change_password = True
    u.failed_logins = 0
    u.locked_until = None
    db.commit()
    log_activity(db, admin, "account", f"Reset the password of {u.account_code or u.email}")
    return {**user_out(u, db), "temporary_password": temp}


@router.post("/users/{user_id}/unlock")
def unlock(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found.")
    u.failed_logins = 0
    u.locked_until = None
    db.commit()
    log_activity(db, admin, "account", f"Unlocked {u.account_code or u.email}")
    return user_out(u, db)


# ------------------------------------------------------- client access ---

class AccessIn(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=500)
    all_test_accounts: bool = False


@router.put("/clients/{client_id}/access")
def set_client_access(client_id: int, body: AccessIn, db: Session = Depends(get_db),
                      admin: User = Depends(require_admin)):
    """Chooses which examiner accounts can screen against a client prepared by
    the research team (e.g. all EVAL test accounts). Replaces the list."""
    c = get_client_or_404(db, client_id)
    ids = set(body.user_ids)
    if body.all_test_accounts:
        ids |= set(db.scalars(select(User.id).where(User.is_test_account.is_(True), User.status == "active")))
    examiners = set(db.scalars(select(User.id).where(User.id.in_(ids), User.role == "examiner"))) if ids else set()
    for a in db.scalars(select(ClientAccess).where(ClientAccess.client_id == c.id)):
        if a.user_id not in examiners:
            db.delete(a)
    have = set(db.scalars(select(ClientAccess.user_id).where(ClientAccess.client_id == c.id)))
    for uid in examiners - have:
        db.add(ClientAccess(client_id=c.id, user_id=uid, granted_by=admin.id))
    db.commit()
    log_activity(db, admin, "client", f"Set access to client {c.client_code}: {len(examiners)} examiner account(s)")
    return {"client_id": c.id, "user_ids": sorted(examiners)}


@router.get("/access-policy")
def access_policy(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """How ForgeBlock applies Chapter 3, Section 3.8 (System Access Control
    and Ethical Use), shown on the Policy page."""
    admins = db.scalars(select(User).where(User.role == "admin")).all()
    tests = _count(db, User, User.is_test_account.is_(True))
    pending = _count(db, User, User.research_use_accepted_at.is_(None), User.status == "active")
    return {
        "self_registration": False,
        "admins": [{"account_code": a.account_code, "email": a.email, "status": a.status,
                    "in_research_team": a.email.lower() in RESEARCH_TEAM_EMAILS} for a in admins],
        "research_team_emails": sorted(RESEARCH_TEAM_EMAILS),
        "test_accounts": tests,
        "accounts_without_research_terms": pending,
        "image_export": False,
        "study_mode": STUDY_MODE,
    }


# -------------------------------------------------------------- audit log ---

@router.get("/audit")
def audit_log(
    user_id: int | None = None,
    activity_type: str | None = None,
    q: str | None = None,
    limit: int = Query(300, le=2000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    stmt = select(ActivityLog).order_by(ActivityLog.id.desc())
    if user_id:
        stmt = stmt.where(ActivityLog.user_id == user_id)
    if activity_type:
        stmt = stmt.where(ActivityLog.activity_type == activity_type)
    if q:
        stmt = stmt.where(func.lower(ActivityLog.description).like(f"%{q.lower()}%"))
    nm = names(db)
    return [{"id": a.id, "user_id": a.user_id, "user_name": nm.get(a.user_id, "System"),
             "activity_type": a.activity_type, "description": a.description, "modality": a.modality,
             "verification_log_id": a.verification_log_id, "created_at": a.created_at}
            for a in db.scalars(stmt.limit(limit))]


@router.get("/records")
def all_records(modality: str | None = None, result: str | None = None, limit: int = Query(300, le=2000),
                db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    stmt = select(VerificationLog).order_by(VerificationLog.id.desc())
    if modality:
        stmt = stmt.where(VerificationLog.modality == modality)
    if result:
        stmt = stmt.where(VerificationLog.screening_result == result)
    nm = names(db)
    return [log_out(l, db, nm) for l in db.scalars(stmt.limit(limit))]


# --------------------------------------------------- settings / retention ---

class RetentionIn(BaseModel):
    days: int = Field(ge=0, le=3650)


@router.get("/settings")
def settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return {
        "retention": get_setting(db, "retention"),
        "security": {"max_failed_logins": MAX_FAILED_LOGINS, "lockout_minutes": LOCKOUT_MINUTES,
                     "idle_timeout_minutes": IDLE_TIMEOUT_MINUTES},
    }


@router.put("/settings/retention")
def set_retention(body: RetentionIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    value = set_setting(db, "retention", {"days": body.days})
    log_activity(db, admin, "settings", f"Set data retention to {body.days or 'unlimited'} day(s) for new clients")
    return value


@router.get("/retention")
def retention_overview(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    now = utcnow()
    clients = db.scalars(select(Client).where(Client.status == "active")).all()
    due = [c for c in clients if c.retention_until and c.retention_until <= now]
    soon = [c for c in clients if c.retention_until and now < c.retention_until <= now + timedelta(days=30)]
    requested = [c for c in clients if c.deletion_requested]
    deleted = _count(db, Client, Client.status == "deleted")
    return {
        "settings": get_setting(db, "retention"),
        "due": [client_out(c, db) for c in due],
        "due_soon": [client_out(c, db) for c in soon],
        "requested": [client_out(c, db) for c in requested],
        "deleted_count": deleted,
    }


def run_retention(db: Session, actor: User | None = None) -> dict:
    """Deletes the signature data of clients past their retention date. The
    ledger keeps its hash-only blocks, so the chain stays valid."""
    now = utcnow()
    due = db.scalars(select(Client).where(Client.status == "active", Client.retention_until.is_not(None),
                                          Client.retention_until <= now)).all()
    codes = []
    for c in due:
        codes.append(c.client_code)
        delete_client_data(db, c)
    if codes:
        log_activity(db, actor, "retention", f"Retention: deleted signature data of {', '.join(codes)}")
    return {"deleted": codes}


@router.post("/retention/run")
def retention_run(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return run_retention(db, admin)


@router.post("/clients/{client_id}/retention")
def set_client_retention(client_id: int, days: int = Query(ge=0, le=3650), db: Session = Depends(get_db),
                         admin: User = Depends(require_admin)):
    c = get_client_or_404(db, client_id)
    c.retention_until = utcnow() + timedelta(days=days) if days else None
    db.commit()
    log_activity(db, admin, "retention", f"Set retention of {c.client_code} to {days or 'unlimited'} day(s)")
    return client_out(c, db)


# ------------------------------------------------------- status and model ---

def _dir_size(path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) if path.exists() else 0


@router.get("/status")
def system_status(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from ..ml.engine import get_engine

    try:
        db.execute(select(1))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    usage = shutil.disk_usage(STORAGE_DIR)
    return {
        "models": get_engine().status(),
        "database": {"ok": db_ok, "kind": "PostgreSQL (Supabase)" if DATABASE_URL.startswith("postgres") else "SQLite"},
        "storage": {"used_mb": round(_dir_size(STORAGE_DIR) / 1e6, 1), "free_gb": round(usage.free / 1e9, 1)},
        "ledger": {"chain_height": chain_height(db), "last_auto_check": last_auto_check()},
        "counts": {
            "users": _count(db, User), "clients": _count(db, Client, Client.status == "active"),
            "references": _count(db, SignatureProfile, SignatureProfile.status == "active"),
            "screenings": _count(db, VerificationLog), "findings": _count(db, Finding),
        },
    }


@router.post("/ledger/check-now")
def ledger_check_now(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from ..database import SessionLocal
    from ..ledger import run_auto_check

    result = run_auto_check(SessionLocal)
    log_activity(db, admin, "ledger", "Ran the ledger auto-check: " + ("intact" if result["valid"] else "FAILED"))
    return result


@router.get("/model")
def model_info(admin: User = Depends(require_admin)):
    from ..config import MIN_ADAPTIVE_SAMPLES
    from ..ml.engine import get_engine

    e = get_engine()
    return {
        "status": e.status(),
        "static": {"thresholds": e.static_cfg["thresholds"], "bounds": e.static_cfg["bounds"],
                   "rule": "Cosine ≥ τc, Euclidean ≤ τE, Manhattan ≤ τM; majority vote (2 of 3)"},
        "dynamic": {"thresholds": e.dynamic_cfg["thresholds"], "bounds": e.dynamic_cfg["bounds"],
                    "rule": "Mean cosine ≥ τc and mean Euclidean ≤ √(2(1 − τc))"},
        "adaptive": f"Personal thresholds with {MIN_ADAPTIVE_SAMPLES} or more references: "
                    "τ = clip(mean − 1.5·sd) of the client's own reference pairs",
        "confidence": "Mean of each metric's margin past its threshold, normalized to 0–100 "
                      "(confidence in the leaning, not a probability)",
    }


def _bundle_checkpoint(data: bytes) -> bytes:
    """best_model.pt from a model bundle zip exported by the dynamic notebook (cell C810)."""
    import io
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if n.rsplit("/", 1)[-1] == "best_model.pt"]
            if len(names) != 1:
                raise HTTPException(422, "The zip must contain exactly one best_model.pt.")
            return z.read(names[0])
    except zipfile.BadZipFile:
        raise HTTPException(422, "The zip file could not be read.")


@router.post("/model/dynamic-weights")
async def upload_dynamic_weights(file: UploadFile = File(...), admin: User = Depends(require_admin),
                                 db: Session = Depends(get_db)):
    """Slot for the trained dynamic model: the bundle zip (or its best_model.pt)
    exported by the team's SVC2004 notebook, or a state dict for the reference
    encoder. The file is test-loaded before it replaces the current one.
    Restart the backend and re-embed after uploading."""
    import tempfile
    from pathlib import Path

    from ..ml.dynamic_model import TORCH_FILENAME, load_model_file

    name = (file.filename or "").lower()
    if not name.endswith((".pt", ".zip")):
        raise HTTPException(422, "Upload the model bundle (.zip) or a PyTorch .pt file.")
    data = await file.read()
    if name.endswith(".zip"):
        data = _bundle_checkpoint(data)
    with tempfile.TemporaryDirectory() as tmp:
        candidate = Path(tmp) / TORCH_FILENAME
        candidate.write_bytes(data)
        try:
            model = load_model_file(candidate)
        except Exception as e:
            raise HTTPException(422, f"This file is not a dynamic model ForgeBlock can load ({type(e).__name__}).")
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    (WEIGHTS_DIR / TORCH_FILENAME).write_bytes(data)
    log_activity(db, admin, "model", f"Uploaded dynamic model weights ({model.kind}, {len(data) // 1024} KB)")
    return {"ok": True, "kind": model.kind, "note": "Restart the backend, then use Re-embed references."}


@router.post("/reembed")
def reembed_profiles(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Recompute stored embeddings with the currently loaded models, e.g.
    after replacing a model file. Uses the saved sample files."""
    from ..ml.dynamic_features import points_from_payload
    from ..ml.engine import get_engine
    from ..services import load_image

    engine = get_engine()
    updated, failed = 0, []
    for p in db.scalars(select(SignatureProfile).where(SignatureProfile.status == "active")):
        try:
            if p.modality == "static":
                img = load_image(p.sample_path)
                if img is None:
                    raise ValueError("image missing")
                p.embedding = engine.static_embedding(img).tolist()
                p.model_version = engine.static_cfg["model_version"]
            else:
                strokes = load_strokes(p.sample_path)
                if strokes is None:
                    raise ValueError("strokes missing")
                pts = points_from_payload(strokes)
                pen = pen_data.enroll_payload(pts)
                p.embedding = pen["embedding"]
                p.capture_device = pen["capture_device"]
                p.features = {**pen_data.public_features(p.features), "_pen": pen["pen"]}
                p.model_version = engine.dynamic_cfg["model_version"]
            updated += 1
        except Exception as e:  # keep going; report which profiles could not be updated
            failed.append({"profile_id": p.id, "error": str(e)})
    db.commit()
    log_activity(db, admin, "model", f"Re-embedded {updated} reference(s)")
    return {"updated": updated, "failed": failed}
