"""Cases: a questioned signature that needs the examiner's decision, its
screenings, notes, the final finding and the timeline.

A case opens automatically when a screening is Inconclusive or Inconsistent,
or an examiner opens one by hand for a document. The examiner gives the
final finding, Genuine or Forged, with the reasons, and the case closes. The
finding is sealed in the ledger next to the screenings it refers to. After a
Genuine finding the examiner may add the questioned signature to the client's
references. Examiners see only their own cases (Chapter 3, Section 3.8);
admins see all.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..access import can_view_case, editable_client_or_404, own_cases, visible_client_ids, visible_client_or_404
from ..database import get_db
from ..ledger import append_block
from ..config import MAX_REFERENCES
from ..ml.engine import get_engine
from ..ml.features import dynamic_features, static_features
from ..ml.quality import dynamic_quality, static_quality
from ..models import BlockchainLedger, Case, CaseEvent, Client, Finding, SignatureProfile, User, VerificationLog, utcnow
from ..security import require_staff
from ..services import (
    case_event,
    load_image,
    load_strokes,
    log_activity,
    next_code,
    save_image,
    save_strokes,
)
from . import pen_data
from .common import active_profiles, examiner_ref, group_examiner, log_out, names

router = APIRouter(prefix="/api/cases", tags=["cases"])

STATUS_LABELS = {"open": "Needs decision", "awaiting_second_opinion": "Closed", "closed": "Closed"}
FINDING_LABELS = {"genuine": "Genuine", "forged": "Forged", "inconclusive": "Inconclusive"}


class CaseIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    client_id: int
    document_ref: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=4000)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class FindingIn(BaseModel):
    finding: str = Field(pattern="^(genuine|forged)$")
    reason: str = Field(min_length=3, max_length=4000)


class AddReferenceIn(BaseModel):
    verification_log_id: int


def finding_out(f: Finding, db: Session, nm: dict) -> dict:
    block = db.scalar(select(BlockchainLedger).where(BlockchainLedger.finding_id == f.id))
    return {
        "id": f.id,
        "finding": f.finding,
        "finding_label": FINDING_LABELS[f.finding],
        "reason": f.reason,
        "examiner_id": f.examiner_id,
        "examiner_name": nm.get(f.examiner_id),
        "verification_log_ids": f.verification_log_ids,
        "second_opinion_status": f.second_opinion_status,  # records made before v7 only
        "second_examiner_name": nm.get(f.second_examiner_id),
        "second_opinion_note": f.second_opinion_note,
        "block_index": block.block_index if block else None,
        "created_at": f.created_at,
    }


def _handler(db: Session, c: Case, client: Client | None, latest: Finding | None) -> dict | None:
    """The examiner who handles the case: who decided it, else the client's
    group examiner, else who opened it."""
    if latest is not None:
        u = db.get(User, latest.examiner_id)
    else:
        u = group_examiner(db, client.group_id) if client is not None else None
        u = u or db.get(User, c.examiner_id)
    return examiner_ref(u)


def case_out(c: Case, db: Session, nm: dict, detail: bool = False) -> dict:
    client = db.get(Client, c.client_id)
    logs = db.scalars(select(VerificationLog).where(VerificationLog.case_id == c.id)
                      .order_by(VerificationLog.id)).all()
    latest = db.scalar(select(Finding).where(Finding.case_id == c.id).order_by(Finding.id.desc()))
    out = {
        "id": c.id,
        "case_code": c.case_code,
        "title": c.title,
        "document_ref": c.document_ref,
        "client_id": c.client_id,
        "client_code": client.client_code if client else None,
        "client_name": client.full_name if client else None,
        "examiner_id": c.examiner_id,
        "examiner_name": nm.get(c.examiner_id),
        "handled_by": _handler(db, c, client, latest),
        "status": c.status,
        "status_label": STATUS_LABELS.get(c.status, c.status),
        "screening_count": len(logs),
        "latest_screening": logs[-1].screening_result if logs else None,
        "finding": latest.finding if latest else None,
        "created_at": c.created_at,
        "closed_at": c.closed_at,
    }
    if detail:
        out["added_references"] = [e.verification_log_id for e in db.scalars(
            select(CaseEvent).where(CaseEvent.case_id == c.id, CaseEvent.kind == "reference_added"))]
        events = db.scalars(select(CaseEvent).where(CaseEvent.case_id == c.id).order_by(CaseEvent.id)).all()
        findings = db.scalars(select(Finding).where(Finding.case_id == c.id).order_by(Finding.id)).all()
        out.update({
            "notes": c.notes,
            "screenings": [log_out(l, db, nm) for l in logs],
            "findings": [finding_out(f, db, nm) for f in findings],
            "timeline": [{"id": e.id, "kind": e.kind, "text": e.text, "user_name": nm.get(e.user_id),
                          "verification_log_id": e.verification_log_id, "created_at": e.created_at}
                         for e in events],
        })
    return out


def _case(db: Session, case_id: int, user: User) -> Case:
    """Examiners see only their own cases; admins (the research team) see all."""
    c = db.get(Case, case_id)
    if c is None or not can_view_case(user, c):
        raise HTTPException(404, "Case not found.")
    return c


@router.get("")
def list_cases(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    status: str | None = Query(None, pattern="^(open|closed)$"),
    q: str | None = None,
    client_id: int | None = None,
    examiner_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Examiners see their own cases; admins see all (scope=all) or their own.
    Admins can also narrow to one examiner (examiner_id): cases that examiner
    opened or decided, and cases of clients in that examiner's group."""
    stmt = own_cases(select(Case).order_by(Case.id.desc()), user)
    if scope == "mine" and user.role == "admin":
        stmt = stmt.where(Case.examiner_id == user.id)
    if status == "open":
        stmt = stmt.where(Case.status == "open")
    elif status == "closed":
        stmt = stmt.where(Case.status != "open")
    if client_id:
        stmt = stmt.where(Case.client_id == client_id)
    if examiner_id is not None:
        if user.role != "admin":
            raise HTTPException(403, "Only administrators can filter by examiner.")
        ex = db.get(User, examiner_id)
        handled = [Case.examiner_id == examiner_id,
                   Case.id.in_(select(Finding.case_id).where(Finding.examiner_id == examiner_id))]
        if ex is not None and ex.group_id:
            handled.append(Case.client_id.in_(select(Client.id).where(Client.group_id == ex.group_id)))
        stmt = stmt.where(or_(*handled))
    if q:
        like = f"%{q.lower()}%"
        client_ids = select(Client.id).where(or_(Client.full_name.ilike(like), Client.client_code.ilike(like)))
        visible = visible_client_ids(db, user)
        if visible is not None:
            client_ids = client_ids.where(Client.id.in_(visible))
        stmt = stmt.where(or_(Case.title.ilike(like), Case.case_code.ilike(like), Case.document_ref.ilike(like),
                              Case.client_id.in_(client_ids)))
    nm = names(db)
    return [case_out(c, db, nm) for c in db.scalars(stmt.limit(300))]


@router.post("")
def open_case(body: CaseIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    client = visible_client_or_404(db, body.client_id, user)
    c = Case(case_code=next_code(db, Case.case_code, "C"), title=body.title.strip(), client_id=client.id,
             document_ref=body.document_ref or None, examiner_id=user.id, notes=body.notes)
    db.add(c)
    db.commit()
    db.refresh(c)
    case_event(db, c.id, user, "opened", f"Case opened for {client.client_code}: {c.title}")
    log_activity(db, user, "case", f"Opened case {c.case_code} ({client.client_code})")
    return case_out(c, db, names(db), detail=True)


@router.get("/{case_id}")
def get_case(case_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    return case_out(_case(db, case_id, user), db, names(db), detail=True)


@router.post("/{case_id}/notes")
def add_note(case_id: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    c = _case(db, case_id, user)
    case_event(db, c.id, user, "note", body.text.strip())
    return case_out(c, db, names(db), detail=True)


@router.post("/{case_id}/finding")
def give_finding(case_id: int, body: FindingIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    c = _case(db, case_id, user)
    if c.status != "open":
        raise HTTPException(409, "This case is closed. Reopen it to change the finding.")
    logs = db.scalars(select(VerificationLog).where(VerificationLog.case_id == c.id)).all()
    if not logs:
        raise HTTPException(409, "Screen at least one questioned signature before giving a finding.")
    f = Finding(case_id=c.id, examiner_id=user.id, finding=body.finding, reason=body.reason.strip(),
                verification_log_ids=[l.id for l in logs])
    db.add(f)
    db.commit()
    db.refresh(f)
    block = append_block(db, f)
    label = FINDING_LABELS[f.finding]
    c.status = "closed"
    c.closed_at = utcnow()
    db.commit()
    case_event(db, c.id, user, "finding", f"Final finding: {label}. {f.reason} (sealed in block #{block.block_index})")
    case_event(db, c.id, user, "closed", "Case closed.")
    log_activity(db, user, "finding", f"Gave the finding {label} on case {c.case_code} (block #{block.block_index})")
    return case_out(c, db, names(db), detail=True)


@router.post("/{case_id}/add-reference")
def add_as_reference(case_id: int, body: AddReferenceIn, db: Session = Depends(get_db),
                     user: User = Depends(require_staff)):
    """After a Genuine finding, adds the questioned signature to the client's
    references so later screenings can match it. Optional and done on
    purpose by the examiner; the screening record itself does not change."""
    c = _case(db, case_id, user)
    f = db.scalar(select(Finding).where(Finding.case_id == c.id).order_by(Finding.id.desc()))
    if c.status != "closed" or f is None or f.finding != "genuine":
        raise HTTPException(409, "Only a signature with a Genuine finding can be added as a reference.")
    log = db.get(VerificationLog, body.verification_log_id)
    if log is None or log.case_id != c.id or log.mode != "verify":
        raise HTTPException(404, "That screening is not part of this case.")
    already = db.scalar(select(CaseEvent).where(CaseEvent.case_id == c.id, CaseEvent.kind == "reference_added",
                                                CaseEvent.verification_log_id == log.id))
    if already is not None:
        raise HTTPException(409, "This signature was already added as a reference.")
    client = editable_client_or_404(db, c.client_id, user)
    have = len(active_profiles(db, client.id, log.modality))
    if have >= MAX_REFERENCES:
        raise HTTPException(422, f"{client.client_code} already has the maximum of {MAX_REFERENCES} "
                                 f"{log.modality} references.")
    engine = get_engine()
    if log.modality == "static":
        img = load_image(log.test_sample_path)
        if img is None:
            raise HTTPException(404, "The questioned image is no longer stored.")
        q = static_quality(img)
        p = SignatureProfile(client_id=client.id, modality="static",
                             sample_path=save_image(img, f"profiles/static/{client.id}"),
                             embedding=engine.static_embedding(img).tolist(),
                             model_version=engine.static_cfg["model_version"],
                             features=static_features(img), quality=q["score"], enrolled_by=user.id)
    else:
        from ..ml.dynamic_features import points_from_payload

        strokes = load_strokes(log.test_sample_path)
        if strokes is None:
            raise HTTPException(404, "The questioned strokes are no longer stored.")
        pts = points_from_payload(strokes)
        pen = pen_data.enroll_payload(pts)
        p = SignatureProfile(client_id=client.id, modality="dynamic",
                             sample_path=save_strokes(strokes, f"profiles/dynamic/{client.id}"),
                             embedding=pen["embedding"],
                             model_version=engine.dynamic_cfg["model_version"],
                             features={**dynamic_features(strokes), "_pen": pen["pen"]},
                             quality=dynamic_quality(strokes)["score"],
                             capture_device=pen["capture_device"], enrolled_by=user.id)
    db.add(p)
    db.commit()
    case_event(db, c.id, user, "reference_added",
               f"Questioned signature {log.receipt_code} added to {client.client_code}'s {log.modality} references.",
               verification_log_id=log.id)
    log_activity(db, user, "enrollment", f"Added screening {log.receipt_code} as a {log.modality} reference "
                                         f"of {client.client_code} (case {c.case_code})", modality=log.modality)
    return case_out(c, db, names(db), detail=True)


@router.post("/{case_id}/reopen")
def reopen(case_id: int, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    c = _case(db, case_id, user)
    if c.status != "closed":
        raise HTTPException(409, "Only closed cases can be reopened.")
    c.status = "open"
    c.closed_at = None
    db.commit()
    case_event(db, c.id, user, "reopened", f"Case reopened: {body.text.strip()}")
    log_activity(db, user, "case", f"Reopened case {c.case_code}")
    return case_out(c, db, names(db), detail=True)
