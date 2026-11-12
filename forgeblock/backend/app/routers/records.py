"""Records (every screening, with a summary), the client's own pages,
receipts, the ledger, notifications and search."""
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import own_cases, own_logs, visible_client_ids, visible_client_or_404
from ..config import DEMO_MODE
from ..database import get_db
from ..ledger import block_record, chain_height, last_auto_check, record_hash, validate_chain, verify_block
from ..models import (
    ActivityLog,
    BlockchainLedger,
    Case,
    Client,
    Finding,
    Notification,
    User,
    utcnow,
    VerificationLog,
)
from ..security import current_user, require_admin, require_roles, require_staff
from ..services import log_activity, notify, staff_ids
from .common import active_profiles, client_out, log_out, names, threshold_strength

router = APIRouter(prefix="/api", tags=["records"])
require_client = require_roles("client")


# ---------------------------------------------------------------- records ---

def _day_end(d: datetime) -> datetime:
    d = d.replace(tzinfo=None)
    return datetime.combine(d.date(), time.max) if d.time() == time(0, 0) else d


@router.get("/records")
def records(
    q: str | None = None,
    modality: str | None = Query(None, pattern="^(static|dynamic)$"),
    result: str | None = Query(None, pattern="^(consistent|inconclusive|inconsistent)$"),
    decision: str | None = Query(None, pattern="^(genuine|forged|pending|none)$"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    examiner_id: int | None = None,
    group_id: int | None = None,
    limit: int = Query(300, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Every screening the user may see (admins: all; examiners: their own),
    newest first, with a summary of the filtered set. Admins can also filter
    by the examiner who screened (examiner_id) and the client's group
    (group_id; 0 = clients without a group)."""
    if (examiner_id is not None or group_id is not None) and user.role != "admin":
        raise HTTPException(403, "Only administrators can filter by examiner or group.")
    stmt = own_logs(select(VerificationLog).where(VerificationLog.mode == "verify"), user)
    if examiner_id is not None:
        stmt = stmt.where(VerificationLog.performed_by == examiner_id)
    if group_id is not None:
        in_group = Client.group_id.is_(None) if group_id == 0 else Client.group_id == group_id
        stmt = stmt.where(VerificationLog.client_id.in_(select(Client.id).where(in_group)))
    if modality:
        stmt = stmt.where(VerificationLog.modality == modality)
    if result:
        stmt = stmt.where(VerificationLog.screening_result == result)
    if date_from:
        stmt = stmt.where(VerificationLog.created_at >= date_from.replace(tzinfo=None))
    if date_to:
        stmt = stmt.where(VerificationLog.created_at <= _day_end(date_to))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        client_ids = select(Client.id).where(or_(func.lower(Client.full_name).like(like),
                                                 func.lower(Client.client_code).like(like)))
        case_ids = select(Case.id).where(func.lower(Case.case_code).like(like))
        stmt = stmt.where(or_(func.lower(VerificationLog.receipt_code).like(like),
                              VerificationLog.client_id.in_(client_ids), VerificationLog.case_id.in_(case_ids)))
    logs = db.scalars(stmt.order_by(VerificationLog.id.desc()).limit(limit)).all()
    nm = names(db)
    rows = [log_out(l, db, nm) for l in logs]
    if decision == "pending":
        rows = [r for r in rows if r["case_status"] == "open"]
    elif decision == "none":
        rows = [r for r in rows if r["case_id"] is None]
    elif decision in ("genuine", "forged"):
        rows = [r for r in rows if r["finding"] == decision]
    summary = {
        "total": len(rows),
        "consistent": sum(r["screening_result"] == "consistent" for r in rows),
        "inconclusive": sum(r["screening_result"] == "inconclusive" for r in rows),
        "inconsistent": sum(r["screening_result"] == "inconsistent" for r in rows),
        "static": sum(r["modality"] == "static" for r in rows),
        "dynamic": sum(r["modality"] == "dynamic" for r in rows),
        "awaiting_decision": sum(r["case_status"] == "open" for r in rows),
        "genuine": sum(r["finding"] == "genuine" for r in rows),
        "forged": sum(r["finding"] == "forged" for r in rows),
    }
    return {"summary": summary, "records": rows}


@router.get("/checks/mine")
def my_checks(limit: int = Query(200, le=1000), db: Session = Depends(get_db), user: User = Depends(require_staff)):
    """Screenings the signed-in user performed (home page)."""
    logs = db.scalars(select(VerificationLog).where(VerificationLog.performed_by == user.id)
                      .order_by(VerificationLog.id.desc()).limit(limit)).all()
    nm = names(db)
    return [log_out(l, db, nm) for l in logs]


@router.get("/home/examiner")
def examiner_home(db: Session = Depends(get_db), user: User = Depends(require_staff)):
    """The examiner's "My work" page: cases waiting for a decision, recent
    screenings and a few counts."""
    from .cases import case_out

    nm = names(db)
    open_cases = db.scalars(own_cases(select(Case).where(Case.status == "open"), user)
                            .order_by(Case.id.desc()).limit(20)).all()
    recent = db.scalars(select(VerificationLog).where(VerificationLog.performed_by == user.id)
                        .order_by(VerificationLog.id.desc()).limit(8)).all()
    week = utcnow() - timedelta(days=7)
    visible = visible_client_ids(db, user)
    cstmt = select(func.count()).select_from(Client).where(Client.status == "active")
    if visible is not None:
        cstmt = cstmt.where(Client.id.in_(visible))
    return {
        "open_cases": [case_out(c, db, nm) for c in open_cases],
        "recent": [log_out(l, db, nm) for l in recent],
        "counts": {
            "open_cases": db.scalar(own_cases(select(func.count()).select_from(Case)
                                              .where(Case.status == "open"), user)) or 0,
            "screenings_week": db.scalar(select(func.count()).select_from(VerificationLog)
                                         .where(VerificationLog.performed_by == user.id,
                                                VerificationLog.created_at >= week)) or 0,
            "decided": db.scalar(select(func.count()).select_from(Finding)
                                 .where(Finding.examiner_id == user.id)) or 0,
            "clients": db.scalar(cstmt) or 0,
        },
    }


@router.get("/activity")
def my_activity(limit: int = Query(100, le=500), db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(ActivityLog).where(ActivityLog.user_id == user.id)
                      .order_by(ActivityLog.id.desc()).limit(limit)).all()
    return [{"id": a.id, "activity_type": a.activity_type, "description": a.description, "modality": a.modality,
             "verification_log_id": a.verification_log_id, "created_at": a.created_at} for a in rows]


# ----------------------------------------------------------------- client ---

def _my_client(db: Session, user: User) -> Client:
    c = db.get(Client, user.client_id) if user.client_id else None
    if c is None:
        raise HTTPException(404, "No signature record is linked to this account.")
    return c


@router.get("/me/client")
def my_client_card(db: Session = Depends(get_db), user: User = Depends(require_client)):
    c = _my_client(db, user)
    out = client_out(c, db)
    out.pop("account", None)
    nm = names(db)
    logs = db.scalars(select(VerificationLog).where(VerificationLog.client_id == c.id)
                      .order_by(VerificationLog.id.desc())).all()
    checks = []
    for l in logs:
        case = db.get(Case, l.case_id) if l.case_id else None
        f = db.scalar(select(Finding).where(Finding.case_id == l.case_id).order_by(Finding.id.desc())) if l.case_id else None
        checks.append({
            "id": l.id, "receipt_code": l.receipt_code, "modality": l.modality,
            "screening_result": l.screening_result, "confidence_score": l.confidence_score,
            "document": case.title if case else l.document_ref, "case_code": case.case_code if case else None,
            "case_status": case.status if case else None,
            "finding": f.finding if (f and case and case.status == "closed") else None,
            "examiner_name": nm.get(l.performed_by),
            "created_at": l.created_at,
        })
    out["checks"] = checks
    return out


class MessageIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


@router.post("/me/report-problem")
def report_problem(body: MessageIn, db: Session = Depends(get_db), user: User = Depends(require_client)):
    c = _my_client(db, user)
    notify(db, staff_ids(db, "admin"), f"{c.client_code} reported a problem: {body.text.strip()[:300]}",
           f"/app/clients/{c.id}")
    log_activity(db, user, "client", f"Reported a problem: {body.text.strip()[:300]}")
    return {"ok": True}


@router.post("/me/request-deletion")
def request_deletion(db: Session = Depends(get_db), user: User = Depends(require_client)):
    c = _my_client(db, user)
    c.deletion_requested = True
    db.commit()
    notify(db, staff_ids(db, "admin"), f"{c.client_code} asked for their signature data to be deleted.",
           "/app/admin/retention")
    log_activity(db, user, "deletion", f"Requested deletion of the signature data of {c.client_code}")
    return {"ok": True}


# --------------------------------------------------------------- receipts ---

@router.get("/receipts/{code}")
def check_receipt(code: str, db: Session = Depends(get_db)):
    """Public: anyone with a receipt code can confirm the record is unchanged.
    No names or images are shown."""
    log = db.scalar(select(VerificationLog).where(VerificationLog.receipt_code == code.strip().upper()))
    if log is None:
        raise HTTPException(404, "No record has this receipt code.")
    block = db.scalar(select(BlockchainLedger).where(BlockchainLedger.verification_log_id == log.id))
    prev = db.scalar(select(BlockchainLedger).where(BlockchainLedger.block_index == block.block_index - 1)) if block else None
    integrity = verify_block(block, log, prev) if block else {"valid": False, "issues": ["No ledger block."]}
    return {
        "receipt_code": log.receipt_code,
        "modality": log.modality,
        "kind": "Screening" if log.mode == "verify" else "Comparison",
        "screening_result": log.screening_result,
        "created_at": log.created_at,
        "block_index": block.block_index if block else None,
        "block_hash": block.block_hash if block else None,
        "intact": integrity["valid"],
        "issues": integrity["issues"],
    }


# ----------------------------------------------------------------- ledger ---

def block_out(b: BlockchainLedger, db: Session) -> dict:
    rec = block_record(db, b)
    summary = None
    if b.record_type == "verification" and rec is not None:
        summary = f"{rec.modality.capitalize()} {'screening' if rec.mode == 'verify' else 'comparison'} · {rec.receipt_code}"
    elif b.record_type == "finding" and rec is not None:
        case = db.get(Case, rec.case_id)
        summary = f"Finding: {rec.finding.capitalize()} · {case.case_code if case else ''}"
    return {
        "block_index": b.block_index,
        "record_type": b.record_type,
        "verification_log_id": b.verification_log_id,
        "finding_id": b.finding_id,
        "summary": summary or ("Genesis block" if b.record_type == "genesis" else "Record missing"),
        "record_hash": b.record_hash,
        "previous_hash": b.previous_hash,
        "block_hash": b.block_hash,
        "timestamp": b.timestamp,
    }


@router.get("/ledger/blocks")
def ledger_blocks(limit: int = Query(50, le=500), offset: int = 0, db: Session = Depends(get_db),
                  admin: User = Depends(require_admin)):
    blocks = db.scalars(select(BlockchainLedger).order_by(BlockchainLedger.block_index.desc())
                        .offset(offset).limit(limit)).all()
    return {"chain_height": chain_height(db), "blocks": [block_out(b, db) for b in blocks],
            "demo_mode": DEMO_MODE, "last_auto_check": last_auto_check()}


@router.get("/ledger/validate")
def ledger_validate(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = validate_chain(db)
    log_activity(db, admin, "ledger", "Validated the ledger: " + ("intact" if result["valid"] else
                                                                   f"{len(result['invalid_blocks'])} block(s) failed"))
    return result


class TamperIn(BaseModel):
    screening_result: str = "consistent"


@router.post("/ledger/demo/tamper/{log_id}")
def ledger_demo_tamper(log_id: int, body: TamperIn, db: Session = Depends(get_db),
                       admin: User = Depends(require_admin)):
    """Demo only: edits a stored screening directly, bypassing the ledger, so
    the integrity check can be shown detecting the change."""
    if not DEMO_MODE:
        raise HTTPException(404, "Not available.")
    log = db.get(VerificationLog, log_id)
    if log is None:
        raise HTTPException(404, "Record not found.")
    original = log.screening_result
    log.screening_result = body.screening_result
    db.commit()
    log_activity(db, admin, "tamper_demo",
                 f"Tamper demo: changed {log.receipt_code} from {original} to {body.screening_result}")
    return {"log_id": log.id, "changed_from": original, "changed_to": log.screening_result}


@router.post("/ledger/demo/restore/{log_id}")
def ledger_demo_restore(log_id: int, body: TamperIn, db: Session = Depends(get_db),
                        admin: User = Depends(require_admin)):
    if not DEMO_MODE:
        raise HTTPException(404, "Not available.")
    log = db.get(VerificationLog, log_id)
    if log is None:
        raise HTTPException(404, "Record not found.")
    log.screening_result = body.screening_result
    db.commit()
    log_activity(db, admin, "tamper_demo", f"Tamper demo: restored {log.receipt_code} to {body.screening_result}")
    return {"log_id": log.id, "screening_result": log.screening_result, "record_hash": record_hash(log)}


# ---------------------------------------------------------- notifications ---

def _unread(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(Notification)
                     .where(Notification.user_id == user.id, Notification.read.is_(False))) or 0


def _notification_out(n: Notification) -> dict:
    return {"id": n.id, "type": n.type or "info", "title": n.text, "body": n.body, "link": n.link,
            "entity_type": n.entity_type, "entity_id": n.entity_id, "read": n.read,
            "read_at": n.read_at, "created_at": n.created_at,
            "text": n.text}  # older clients read "text"


@router.get("/notifications")
def my_notifications(limit: int = Query(20, ge=1, le=100), before: int | None = None,
                     db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The signed-in user's own notifications, newest first. Page with
    `before` = the id of the last item already shown."""
    stmt = select(Notification).where(Notification.user_id == user.id)
    if before:
        stmt = stmt.where(Notification.id < before)
    rows = db.scalars(stmt.order_by(Notification.id.desc()).limit(limit + 1)).all()
    return {"unread": _unread(db, user), "items": [_notification_out(n) for n in rows[:limit]],
            "has_more": len(rows) > limit}


@router.get("/notifications/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"unread": _unread(db, user)}


@router.post("/notifications/{notification_id}/read")
def read_one(notification_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(404, "Notification not found.")
    if not n.read:
        n.read, n.read_at = True, utcnow()
        db.commit()
    return {"ok": True, "unread": _unread(db, user)}


@router.post("/notifications/read-all")
@router.post("/notifications/read")  # older name
def read_all(db: Session = Depends(get_db), user: User = Depends(current_user)):
    now = utcnow()
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))):
        n.read, n.read_at = True, now
    db.commit()
    return {"ok": True, "unread": 0}


# ----------------------------------------------------------------- search ---

@router.get("/search")
def search(q: str = Query(min_length=2), db: Session = Depends(get_db), user: User = Depends(require_staff)):
    like = f"%{q.strip().lower()}%"
    cstmt = select(Client).where(Client.status == "active", or_(
        func.lower(Client.full_name).like(like), func.lower(Client.client_code).like(like)))
    visible = visible_client_ids(db, user)
    if visible is not None:
        cstmt = cstmt.where(Client.id.in_(visible))
    clients = db.scalars(cstmt.limit(8)).all()
    kstmt = select(Case).where(or_(
        func.lower(Case.title).like(like), func.lower(Case.case_code).like(like),
        func.lower(Case.document_ref).like(like)))
    cases = db.scalars(own_cases(kstmt, user).limit(8)).all()
    receipts = db.scalars(own_logs(select(VerificationLog).where(
        func.lower(VerificationLog.receipt_code).like(like)), user).limit(8)).all()
    return {
        "clients": [{"id": c.id, "client_code": c.client_code, "full_name": c.full_name} for c in clients],
        "cases": [{"id": c.id, "case_code": c.case_code, "title": c.title, "status": c.status} for c in cases],
        "receipts": [{"id": l.id, "receipt_code": l.receipt_code, "modality": l.modality,
                      "screening_result": l.screening_result} for l in receipts],
    }


@router.get("/clients-summary/{client_id}")
def client_strength(client_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    """Small summary used by the screening page's client picker."""
    c = visible_client_or_404(db, client_id, user)
    return {m: threshold_strength(len(active_profiles(db, c.id, m))) for m in ("static", "dynamic")}
