"""Screening: a questioned signature against a client's references, for
both modules (Sections 3.4.1 and 3.4.2). The two modules are separate: a
screening is either static or dynamic, never a fused score. The client's
personal thresholds are used once they have enough references.

An Inconclusive or Inconsistent screening opens a case for the examiner's
final finding. A signature that was already examined (same file or the same
stroke data) shows the earlier finding next to the model's result.
"""
import hashlib
import json

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import can_view_case, can_view_log, visible_client_or_404
from ..config import MIN_ADAPTIVE_SAMPLES
from ..database import get_db
from ..ledger import verify_block
from ..ml import decision as dec
from ..ml.dynamic_features import points_from_payload
from ..ml.engine import get_engine
from ..ml.explain import overlay_png
from ..ml.features import compare_features, dynamic_features, static_features
from ..ml.preprocessing import preprocessed_preview
from ..ml.quality import dynamic_quality, static_quality
from ..ml.screening import DISCLAIMER, caption
from ..models import BlockchainLedger, Case, Finding, SignatureProfile, User, VerificationLog
from ..security import current_user, require_staff
from ..services import (
    load_image,
    load_strokes,
    prior_decision,
    record_verification,
    save_image,
    save_strokes,
    storage_path,
)
from .common import VIEW_ONLY_HEADERS, active_profiles, client_safe, log_out, read_upload, threshold_strength

router = APIRouter(tags=["screening"])

METRIC_LABELS = {"cosine": "Cosine similarity", "euclidean": "Euclidean distance", "manhattan": "Manhattan distance"}


def _votes(l: VerificationLog) -> dict:
    m, t = l.metrics, l.thresholds
    v = {"cosine": m["cosine"] >= t["cosine"], "euclidean": m["euclidean"] <= t["euclidean"]}
    if "manhattan" in t:
        v["manhattan"] = m["manhattan"] <= t["manhattan"]
    return v


def result_out(l: VerificationLog, db: Session, viewer: User) -> dict:
    """Everything the result page shows for one screening."""
    out = log_out(l, db)
    block = db.scalar(select(BlockchainLedger).where(BlockchainLedger.verification_log_id == l.id))
    prev = None
    if block is not None:
        prev = db.scalar(select(BlockchainLedger).where(BlockchainLedger.block_index == block.block_index - 1))
    integrity = verify_block(block, l, prev) if block else {"valid": False, "issues": ["No ledger block."]}
    out.update({
        "caption": caption(l.screening_result, l.confidence_score, l.mode),
        "disclaimer": DISCLAIMER,
        "votes": _votes(l),
        "metric_labels": METRIC_LABELS,
        "decision_rule": "Majority vote (2 of 3 metrics)" if l.modality == "static"
        else "Cosine and Euclidean must both pass",
        "block": {
            "block_index": block.block_index,
            "record_hash": block.record_hash,
            "previous_hash": block.previous_hash,
            "block_hash": block.block_hash,
            "timestamp": block.timestamp,
        } if block else None,
        "integrity": integrity,
        "stored_sample": storage_path(l.test_sample_path) is not None,
    })
    if viewer.role in ("admin", "examiner"):
        out["analysis"] = l.analysis or {}
        out["best_match_profile_id"] = l.best_match_profile_id
        out["reference_profile_ids"] = list(l.reference_profile_ids or [])
        out["strength"] = threshold_strength(len(l.reference_profile_ids or [])) if l.mode == "verify" else None
        out["internal_decision"] = l.classification  # for evaluation pages only
    out["case"] = None
    out["finding"] = None
    if l.case_id:
        case = db.get(Case, l.case_id)
        f = db.scalar(select(Finding).where(Finding.case_id == l.case_id).order_by(Finding.id.desc()))
        if case is not None:
            out["case"] = {"id": case.id, "case_code": case.case_code, "status": case.status,
                           "can_open": can_view_case(viewer, case)}
        if f is not None and case is not None and case.status == "closed":
            out["finding"] = {"finding": f.finding, "finding_label": f.finding.capitalize(), "reason": f.reason}
    prior = prior_decision(db, l.client_id, l.sample_hash, exclude_log_id=l.id)
    if prior is not None and prior["case_id"] != l.case_id:
        case = db.get(Case, prior["case_id"])
        prior["can_open"] = bool(case and can_view_case(viewer, case))
        if viewer.role == "client":
            prior.pop("examiner_id", None)
        out["prior_decision"] = prior
    else:
        out["prior_decision"] = None
    if viewer.role == "client":
        out.pop("votes", None)
        out.pop("metric_labels", None)
        out.pop("decision_rule", None)
        if out.get("case"):
            out["case"]["can_open"] = False
        if out.get("finding"):
            out["finding"].pop("reason", None)  # the examiner's notes stay internal
        out["examiner_name"] = out.get("performed_by_name")
        client_safe(out)
    return out


def _check_case(db: Session, case_id: int | None, client_id: int, user: User) -> Case | None:
    if not case_id:
        return None
    case = db.get(Case, case_id)
    if case is None or not can_view_case(user, case):
        raise HTTPException(404, "Case not found.")
    if case.client_id != client_id:
        raise HTTPException(422, "That case is for a different client.")
    if case.status == "closed":
        raise HTTPException(409, "This case is closed. Reopen it to add screenings.")
    return case


def _expected(label: str | None) -> str | None:
    if label in (None, "", "unknown"):
        return None
    if label not in ("genuine", "forged"):
        raise HTTPException(422, "Known answer must be genuine or forged.")
    return label


def _per_ref(test: np.ndarray, profiles: list[SignatureProfile]) -> tuple[list[dict], int]:
    rows = []
    for p in profiles:
        m = dec.pair_metrics(test, np.array(p.embedding))
        rows.append({"profile_id": p.id, "cosine": round(m["cosine"], 4)})
    best = max(rows, key=lambda r: r["cosine"])["profile_id"]
    return rows, best


def _exact_match(test: np.ndarray, refs: list[np.ndarray], profiles: list[SignatureProfile]) -> dict | None:
    """The reference on file that is the same sample as the questioned one."""
    i = dec.exact_match_index(test, refs)
    if i is None:
        return None
    return {"profile_id": profiles[i].id, "position": i + 1}


# ------------------------------------------------------------------ static ---

@router.post("/api/static/preprocess")
async def static_preprocess(file: UploadFile = File(...), user: User = Depends(require_staff)):
    """The preprocessed 224x224 image: what the model sees."""
    _, img = await read_upload(file)
    ok, png = cv2.imencode(".png", cv2.cvtColor(preprocessed_preview(img), cv2.COLOR_RGB2BGR))
    return Response(content=png.tobytes(), media_type="image/png")


@router.post("/api/static/quality")
async def static_quality_check(file: UploadFile = File(...), user: User = Depends(require_staff)):
    _, img = await read_upload(file)
    return static_quality(img)


def screen_static_image(db: Session, user: User, client, img: np.ndarray, case: Case | None = None,
                        document_ref: str | None = None, expected_label: str | None = None,
                        sample_hash: str | None = None) -> VerificationLog:
    """Screens one questioned image against a client's static references."""
    engine = get_engine()
    profiles = active_profiles(db, client.id, "static")
    if not profiles:
        raise HTTPException(409, f"{client.client_code} has no static references on file yet.")
    q = static_quality(img)
    if not q["usable"]:
        raise HTTPException(422, " ".join(q["issues"]))
    test = engine.static_embedding(img)
    refs = [np.array(p.embedding) for p in profiles]
    decision = dec.screen_static_embedding(test, refs, engine.static_cfg, MIN_ADAPTIVE_SAMPLES)
    per_ref, best = _per_ref(test, profiles)
    analysis = {
        "quality": q,
        "exact_match": _exact_match(test, refs, profiles),
        "per_reference": per_ref,
        "features": compare_features(static_features(img), [p.features for p in profiles], "static"),
    }
    log, _ = record_verification(
        db, user=user, modality="static", mode="verify", decision=decision,
        test_sample_path=save_image(img, f"questioned/static/{client.id}"), client=client,
        case_id=case.id if case else None, reference_profile_ids=[p.id for p in profiles],
        document_ref=document_ref or (case.document_ref if case else None),
        expected_label=expected_label, best_match_profile_id=best, analysis=analysis,
        sample_hash=sample_hash,
    )
    return log


@router.post("/api/screen/static")
async def screen_static(
    file: UploadFile = File(...),
    client_id: int = Form(...),
    case_id: int | None = Form(None),
    document_ref: str | None = Form(None),
    expected_label: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    client = visible_client_or_404(db, client_id, user)
    case = _check_case(db, case_id, client.id, user)
    data, img = await read_upload(file)
    log = screen_static_image(db, user, client, img, case, document_ref, _expected(expected_label),
                              sample_hash=hashlib.sha256(data).hexdigest())
    return result_out(log, db, user)


# ----------------------------------------------------------------- dynamic ---

Strokes = list[list[dict]]


class DynamicScreenIn(BaseModel):
    test: Strokes
    client_id: int
    case_id: int | None = None
    document_ref: str | None = None
    expected_label: str | None = None


def _dyn_embedding(strokes: Strokes) -> tuple[np.ndarray, str]:
    """Embedding and capture device ("standard", or "development" for a pen
    without tilt accepted under DEV_PEN_DEVICES)."""
    try:
        pts = points_from_payload(strokes)
        engine = get_engine()
        return engine.dynamic_embedding(pts), engine.dynamic_capture_device(pts)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, str(e) if isinstance(e, ValueError) else "Malformed stroke data.")


def _same_device(profiles: list[SignatureProfile], device: str) -> list[SignatureProfile]:
    """Development-pen signatures are compared only with development-pen
    references, and Apple Pencil signatures only with Apple Pencil ones."""
    want = "development" if device == "development" else None
    return [p for p in profiles if p.capture_device == want]


@router.post("/api/screen/dynamic")
def screen_dynamic(body: DynamicScreenIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    engine = get_engine()
    client = visible_client_or_404(db, body.client_id, user)
    case = _check_case(db, body.case_id, client.id, user)
    profiles = active_profiles(db, client.id, "dynamic")
    if not profiles:
        raise HTTPException(409, f"{client.client_code} has no dynamic references on file yet.")
    q = dynamic_quality(body.test)
    if not q["usable"]:
        raise HTTPException(422, " ".join(q["issues"]))
    test, device = _dyn_embedding(body.test)
    profiles = _same_device(profiles, device)
    if not profiles:
        kind = "development-pen" if device == "development" else "Apple Pencil"
        raise HTTPException(409, f"{client.client_code} has no {kind} dynamic references. "
                                 "Signatures are compared only with references from the same kind of pen.")
    refs = [np.array(p.embedding) for p in profiles]
    decision = dec.screen_dynamic_embedding(test, refs, engine.dynamic_cfg, MIN_ADAPTIVE_SAMPLES)
    per_ref, best = _per_ref(test, profiles)
    analysis = {
        "quality": q,
        "exact_match": _exact_match(test, refs, profiles),
        "per_reference": per_ref,
        "features": compare_features(dynamic_features(body.test), [p.features for p in profiles], "dynamic"),
    }
    log, _ = record_verification(
        db, user=user, modality="dynamic", mode="verify", decision=decision,
        test_sample_path=save_strokes(body.test, f"questioned/dynamic/{client.id}"), client=client,
        case_id=case.id if case else None, reference_profile_ids=[p.id for p in profiles],
        document_ref=body.document_ref or (case.document_ref if case else None),
        expected_label=_expected(body.expected_label), best_match_profile_id=best, analysis=analysis,
        capture_device=device,
        sample_hash=hashlib.sha256(json.dumps(body.test, sort_keys=True).encode()).hexdigest(),
    )
    return result_out(log, db, user)


# ----------------------------------------------------------------- results ---

def _visible_log(db: Session, log_id: int, user: User) -> VerificationLog:
    log = db.get(VerificationLog, log_id)
    # Examiners see only screenings they performed; clients only their own.
    if log is None or not can_view_log(user, log):
        raise HTTPException(404, "Record not found.")
    return log


@router.get("/api/verifications/{log_id}")
def verification_detail(log_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return result_out(_visible_log(db, log_id, user), db, user)


@router.get("/api/verifications/{log_id}/image")
def questioned_image(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    log = _visible_log(db, log_id, user)
    path = storage_path(log.test_sample_path) if log.modality == "static" else None
    if path is None:
        raise HTTPException(404, "The questioned image is not stored for this record.")
    return FileResponse(path, media_type="image/png", headers=VIEW_ONLY_HEADERS)


@router.get("/api/verifications/{log_id}/strokes")
def questioned_strokes(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    log = _visible_log(db, log_id, user)
    strokes = load_strokes(log.test_sample_path) if log.modality == "dynamic" else None
    if strokes is None:
        raise HTTPException(404, "The questioned strokes are not stored for this record.")
    return {"strokes": strokes}


@router.get("/api/verifications/{log_id}/overlay")
def difference_overlay(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    log = _visible_log(db, log_id, user)
    test_img = load_image(log.test_sample_path) if log.modality == "static" else None
    best = db.get(SignatureProfile, log.best_match_profile_id) if log.best_match_profile_id else None
    ref_img = load_image(best.sample_path) if best else None
    if test_img is None or ref_img is None:
        raise HTTPException(404, "The overlay needs the stored questioned image and its best-match reference.")
    return Response(content=overlay_png(test_img, ref_img), media_type="image/png", headers=VIEW_ONLY_HEADERS)
