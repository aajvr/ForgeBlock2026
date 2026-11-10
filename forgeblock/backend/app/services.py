"""Shared helpers: storage, settings, codes, notifications, the audit log and
recording screenings (the only way verification records are written)."""
import json
import secrets
import uuid
from pathlib import Path

import cv2
import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import DEFAULT_RETENTION_DAYS, INCONCLUSIVE_BELOW, STORAGE_DIR
from .ledger import append_block
from .ml.decision import Decision
from .ml.screening import screening_result
from .models import ActivityLog, Case, CaseEvent, Client, Finding, Notification, Setting, User, VerificationLog

# ---------------------------------------------------------------- storage ---


def save_image(img: np.ndarray, folder: str) -> str:
    rel = Path(folder) / f"{uuid.uuid4().hex}.png"
    path = STORAGE_DIR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)
    return rel.as_posix()


def save_strokes(strokes: list, folder: str) -> str:
    rel = Path(folder) / f"{uuid.uuid4().hex}.json"
    path = STORAGE_DIR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(strokes))
    return rel.as_posix()


def storage_path(rel: str) -> Path | None:
    """Resolve a stored sample path safely; None if missing or not stored."""
    if not rel or rel.startswith("sha256:"):
        return None
    path = (STORAGE_DIR / rel).resolve()
    if not path.is_relative_to(STORAGE_DIR.resolve()) or not path.exists():
        return None
    return path


def load_image(rel: str) -> np.ndarray | None:
    path = storage_path(rel)
    return cv2.imread(str(path), cv2.IMREAD_COLOR) if path else None


def load_strokes(rel: str) -> list | None:
    path = storage_path(rel)
    return json.loads(path.read_text()) if path else None


def delete_file(rel: str) -> None:
    path = storage_path(rel)
    if path:
        path.unlink(missing_ok=True)


# --------------------------------------------------------------- settings ---

DEFAULT_SETTINGS = {
    "retention": {"days": DEFAULT_RETENTION_DAYS},
}


def get_setting(db: Session, key: str) -> dict:
    row = db.get(Setting, key)
    return {**DEFAULT_SETTINGS.get(key, {}), **(row.value if row else {})}


def set_setting(db: Session, key: str, value: dict) -> dict:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
    db.commit()
    return get_setting(db, key)


def inconclusive_band(db: Session) -> float:
    """One fixed cut-off (INCONCLUSIVE_BELOW); the old Strict/Balanced/Lenient
    presets were removed in v8."""
    return INCONCLUSIVE_BELOW


# ------------------------------------------------------------------ codes ---


def next_code(db: Session, column, prefix: str, width: int = 4) -> str:
    count = db.scalar(select(func.count()).where(column.like(f"{prefix}-%"))) or 0
    while True:
        count += 1
        code = f"{prefix}-{count:0{width}d}"
        if not db.scalar(select(func.count()).where(column == code)):
            return code


_RECEIPT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_receipt_code(db: Session) -> str:
    while True:
        raw = "".join(secrets.choice(_RECEIPT_ALPHABET) for _ in range(8))
        code = f"FB-{raw[:4]}-{raw[4:]}"
        if not db.scalar(select(VerificationLog.id).where(VerificationLog.receipt_code == code)):
            return code


# ---------------------------------------------------- audit + notifications ---


def log_activity(
    db: Session,
    user: User | None,
    activity_type: str,
    description: str,
    modality: str | None = None,
    verification_log_id: int | None = None,
) -> None:
    db.add(
        ActivityLog(
            user_id=user.id if user else None,
            activity_type=activity_type,
            description=description,
            modality=modality,
            verification_log_id=verification_log_id,
        )
    )
    db.commit()


def notify(db: Session, user_ids, text: str, link: str | None = None) -> None:
    for uid in set(user_ids):
        db.add(Notification(user_id=uid, text=text, link=link))
    db.commit()


def staff_ids(db: Session, role: str = "admin") -> list[int]:
    return list(db.scalars(select(User.id).where(User.role == role, User.status == "active")))


def case_event(db: Session, case_id: int, user: User | None, kind: str, text: str,
               verification_log_id: int | None = None) -> None:
    db.add(CaseEvent(case_id=case_id, user_id=user.id if user else None, kind=kind, text=text,
                     verification_log_id=verification_log_id))
    db.commit()


# --------------------------------------------------------------- clients ---


def client_by_id(db: Session, client_id: int) -> Client | None:
    c = db.get(Client, client_id)
    return c if c is not None and c.status == "active" else None


# ------------------------------------------------------------- screenings ---


def prior_decision(db: Session, client_id: int | None, sample_hash: str | None,
                   exclude_log_id: int | None = None) -> dict | None:
    """The latest examiner finding on this exact signature (same file or same
    stroke data, same client), if it was already examined in a closed case.
    The model's result is never changed by it; it is shown next to it."""
    if not client_id or not sample_hash:
        return None
    stmt = (select(VerificationLog.case_id)
            .where(VerificationLog.client_id == client_id, VerificationLog.sample_hash == sample_hash,
                   VerificationLog.case_id.is_not(None)))
    if exclude_log_id:
        stmt = stmt.where(VerificationLog.id != exclude_log_id)
    case_ids = set(db.scalars(stmt))
    if not case_ids:
        return None
    f = db.scalar(select(Finding).join(Case, Case.id == Finding.case_id)
                  .where(Finding.case_id.in_(case_ids), Case.status == "closed",
                         Finding.finding.in_(("genuine", "forged")))
                  .order_by(Finding.id.desc()))
    if f is None:
        return None
    case = db.get(Case, f.case_id)
    examiner = db.get(User, f.examiner_id)
    return {"finding": f.finding, "finding_label": f.finding.capitalize(), "reason": f.reason,
            "examiner_id": f.examiner_id, "examiner_name": examiner.full_name if examiner else None,
            "case_id": case.id, "case_code": case.case_code, "decided_at": f.created_at}


# Screening results that open a case automatically for the examiner.
NEEDS_DECISION = ("inconclusive", "inconsistent")


def record_verification(
    db: Session,
    *,
    user: User,
    modality: str,
    mode: str,
    decision: Decision,
    test_sample_path: str,
    client: Client | None = None,
    case_id: int | None = None,
    reference_profile_ids: list[int] | None = None,
    document_ref: str | None = None,
    expected_label: str | None = None,
    best_match_profile_id: int | None = None,
    analysis: dict | None = None,
    capture_device: str | None = None,
    sample_hash: str | None = None,
) -> tuple[VerificationLog, int]:
    """Store the screening, append its ledger block and log the activity.

    An Inconclusive or Inconsistent screening made outside a case opens a case
    automatically, so the examiner gives the final finding (Genuine or
    Forged). This is skipped when the same signature was already decided, and
    for prepared evaluation samples (known answer). The case is created before
    the record, because the case number is part of the sealed record."""
    result = screening_result(decision, inconclusive_band(db))
    auto_case = None
    if (mode == "verify" and client is not None and case_id is None and expected_label is None
            and result in NEEDS_DECISION and prior_decision(db, client.id, sample_hash) is None):
        auto_case = Case(case_code=next_code(db, Case.case_code, "C"),
                         title=f"{result.capitalize()} {modality} screening", client_id=client.id,
                         document_ref=document_ref or None, examiner_id=user.id)
        db.add(auto_case)
        db.commit()
        db.refresh(auto_case)
        case_id = auto_case.id
        case_event(db, case_id, None, "opened",
                   f"Case opened automatically: the {modality} screening against {client.client_code} "
                   f"was {result.capitalize()}. The examiner decides Genuine or Forged.")
    log = VerificationLog(
        receipt_code=new_receipt_code(db),
        modality=modality,
        mode=mode,
        performed_by=user.id,
        client_id=client.id if client else None,
        case_id=case_id,
        reference_profile_ids=reference_profile_ids or [],
        test_sample_path=test_sample_path,
        sample_hash=sample_hash,
        document_ref=document_ref or None,
        similarity_score=decision.similarity,
        confidence_score=decision.confidence,
        metrics=decision.metrics,
        thresholds=decision.thresholds,
        threshold_source=decision.threshold_source,
        classification=decision.classification,
        screening_result=result,
        expected_label=expected_label,
        best_match_profile_id=best_match_profile_id,
        analysis=analysis or {},
        capture_device=capture_device if capture_device in ("development", "limited") else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    block = append_block(db, log)

    label = result.capitalize()
    if mode == "verify":
        what = f"Screened a {modality} signature against {client.client_code}"
    else:
        what = f"Compared two {modality} signatures"
    log_activity(
        db, user, "screening" if mode == "verify" else "compare",
        f"{what}: {label} ({decision.confidence:.1f}% confidence), receipt {log.receipt_code}",
        modality=modality, verification_log_id=log.id,
    )
    if case_id:
        case_event(db, case_id, user, "screening",
                   f"{modality.capitalize()} screening {log.receipt_code}: {label} "
                   f"({decision.confidence:.0f}% confidence)",
                   verification_log_id=log.id)
    if auto_case is not None:
        log_activity(db, user, "case", f"Case {auto_case.case_code} opened automatically for {client.client_code}")
    return log, block.block_index
