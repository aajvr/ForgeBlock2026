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
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import can_view_case, can_view_log, visible_client_or_404
from ..config import CLIENT_FULL_RESULTS, MIN_ADAPTIVE_SAMPLES
from ..database import get_db
from ..ledger import verify_block
from ..ml import capture
from ..ml import client_classifier as cc
from ..ml import decision as dec
from ..ml import text_removal
from ..ml.dynamic_features import points_from_payload
from ..ml.engine import get_engine
from ..ml.explain import overlay_png
from ..ml.features import compare_features, dynamic_features, static_feature_marks, static_features
from ..ml.preprocessing import preprocessed_preview
from ..ml.quality import dynamic_quality, static_quality
from ..ml.screening import CALIBRATED_BAND, DISCLAIMER, caption
from ..models import BlockchainLedger, Case, Client, Finding, SignatureProfile, User, VerificationLog
from ..security import current_user, require_result_viewer, require_staff
from ..services import (
    get_setting,
    load_image,
    load_strokes,
    prior_decision,
    record_verification,
    save_image,
    save_strokes,
    storage_path,
)
from . import pen_data
from .common import (VIEW_ONLY_HEADERS, active_profiles, client_safe, log_out, model_view_png, read_upload,
                     reference_width, threshold_strength)

router = APIRouter(tags=["screening"])

METRIC_LABELS = {"cosine": "Cosine similarity", "euclidean": "Euclidean distance", "manhattan": "Manhattan distance"}


def _votes(l: VerificationLog) -> dict:
    m, t = l.metrics, l.thresholds
    v = {"cosine": m["cosine"] >= t["cosine"], "euclidean": m["euclidean"] <= t["euclidean"]}
    if "manhattan" in t:
        v["manhattan"] = m["manhattan"] <= t["manhattan"]
    return v


def explain_result(l: VerificationLog) -> dict | None:
    """v8.14: plain-language reason for the result (staff only). With a calibrated
    model the confidence is the probability of the shown side, so P(genuine)
    can be recovered from it and the stored classification."""
    cfg = get_engine().static_cfg if l.modality == "static" else get_engine().dynamic_cfg
    cal = cfg.get("calibration")
    if not cal:
        return None
    lo, hi = dec._band(cal) or CALIBRATED_BAND
    p = l.confidence_score if l.classification == "genuine" else 100 - l.confidence_score
    p = round(float(min(99.0, max(1.0, p))))
    lo, hi = round(lo * 100), round(hi * 100)
    votes = _votes(l) or {}
    all_pass = bool(votes) and all(votes.values())
    if l.screening_result == "consistent":
        why = f"The chance that this signature is genuine is about {p}%, above the {hi}% needed for Consistent."
    elif l.screening_result == "inconsistent":
        why = f"The chance that this signature is genuine is only about {p}%, below the {lo}% line for Inconsistent."
    else:
        side = "leans genuine" if p >= 50 else "leans not genuine"
        why = (f"The chance that this signature is genuine is about {p}%: it {side}, but it falls between "
               f"{lo}% and {hi}%, too close to call either way, so an examiner should review it.")
        if all_pass:
            why += (" Every score passed its threshold, but only by a little compared with how much this "
                    "client's own signatures vary, and signatures that only just pass are often skilled forgeries.")
    return {"p_genuine": p, "band": [lo, hi], "all_pass": all_pass, "why": why}


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
        # v8.11: plain-language note when pen pressure/tilt was left out (all viewers)
        "pen_note": (l.analysis or {}).get("pen_data") if l.modality == "dynamic" else None,
    })
    full = viewer.role in ("admin", "examiner") or (viewer.role == "client" and CLIENT_FULL_RESULTS)
    if full:
        out["analysis"] = l.analysis or {}
        out["best_match_profile_id"] = l.best_match_profile_id
        out["reference_profile_ids"] = list(l.reference_profile_ids or [])
        out["strength"] = threshold_strength(len(l.reference_profile_ids or [])) if l.mode == "verify" else None
        if viewer.role != "client":
            out["internal_decision"] = l.classification  # for evaluation pages only
        out["explain"] = explain_result(l)
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
        if not CLIENT_FULL_RESULTS:
            out.pop("votes", None)
            out.pop("metric_labels", None)
            out.pop("decision_rule", None)
        if out.get("case"):
            out["case"]["can_open"] = False
        if out.get("finding"):
            out["finding"].pop("reason", None)  # the examiner's notes stay internal
        out["examiner_name"] = out.get("performed_by_name")
        if not CLIENT_FULL_RESULTS:
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
async def static_preprocess(file: UploadFile = File(...), remove_text: bool = Form(False),
                            user: User = Depends(require_staff)):
    """The preprocessed 224x224 image: what the model sees."""
    img = await _questioned_upload(file, remove_text)
    ok, png = cv2.imencode(".png", cv2.cvtColor(preprocessed_preview(img), cv2.COLOR_RGB2BGR))
    return Response(content=png.tobytes(), media_type="image/png")


@router.post("/api/static/quality")
async def static_quality_check(file: UploadFile = File(...), remove_text: bool = Form(False),
                               user: User = Depends(require_staff)):
    img = await _questioned_upload(file, remove_text)
    return static_quality(img)


@router.get("/api/static/text-removal")
def text_removal_status(user: User = Depends(require_staff)):
    """Whether the Screen page shows the "Remove printed text" option (v8.21)."""
    return {"available": text_removal.available()}


async def _questioned_upload(file: UploadFile, remove_text: bool, keep: dict | None = None) -> np.ndarray:
    """A questioned static image as the screening uses it. With remove_text the
    printed-text remover runs on the RAW photo (it needs the text whole) and
    replaces the line eraser; `keep` receives the raw bytes, image and info."""
    if not remove_text:
        data, img = await read_upload(file)
        if keep is not None:
            keep.update(data=data)
        return img
    data, raw = await read_upload(file, standardized=False)
    img, info = text_removal.clean_questioned(raw)
    if keep is not None:
        keep.update(data=data, raw=raw, info=info)
    return img


_reference_width = reference_width  # shared cache in common.py (v8.23)


def _background(db: Session, client_id: int, model_version: str, dim: int) -> tuple[np.ndarray | None, int]:
    """Static reference embeddings of OTHER clients (same model), up to
    REFS_PER_BACKGROUND_CLIENT each, for the per-client classifier. Used inside
    the model only; nothing about these clients is shown."""
    rows = db.execute(
        select(SignatureProfile.client_id, SignatureProfile.embedding)
        .join(Client, Client.id == SignatureProfile.client_id)
        .where(Client.status == "active", SignatureProfile.modality == "static", SignatureProfile.status == "active",
               SignatureProfile.client_id != client_id, SignatureProfile.model_version == model_version)
        .order_by(SignatureProfile.client_id, SignatureProfile.id)
    ).all()
    per: dict[int, list] = {}
    for cid, emb in rows:
        if emb is not None and len(emb) == dim and len(per.setdefault(cid, [])) < cc.REFS_PER_BACKGROUND_CLIENT:
            per[cid].append(emb)
    usable = [cid for cid, e in per.items() if len(e) >= MIN_ADAPTIVE_SAMPLES]
    if len(usable) > cc.MAX_BACKGROUND_CLIENTS:  # a fixed, even spread over the clients
        idx = np.linspace(0, len(usable) - 1, cc.MAX_BACKGROUND_CLIENTS).round().astype(int)
        usable = [usable[i] for i in idx]
    if len(usable) < cc.MIN_BACKGROUND_CLIENTS:
        return None, len(usable)
    return np.array([e for cid in usable for e in per[cid]], np.float64), len(usable)


def _client_classifier(db: Session, client_id: int, test: np.ndarray, refs: list[np.ndarray],
                       decision, cfg: dict) -> dict:
    """v8.10: replaces the result's probability with the per-client
    classifier's when there is a calibration and enough other clients."""
    cal = cfg.get("client_classifier")
    info = {"used": False, "background_clients": 0, "min_background_clients": cc.MIN_BACKGROUND_CLIENTS}
    if not cal or len(refs) < MIN_ADAPTIVE_SAMPLES:
        return info
    neg, k = _background(db, client_id, cfg["model_version"], len(test))
    info["background_clients"] = k
    if neg is None:
        return info
    s = float(cc.fit(np.array(refs), neg)(test)[0])
    p = cc.probability(s, cal)
    info.update(used=True, score=round(s, 4), p_distance_only=decision.p_genuine)
    dec.with_probability(decision, p, cal)
    return info


def screen_static_image(db: Session, user: User, client, img: np.ndarray, case: Case | None = None,
                        document_ref: str | None = None, expected_label: str | None = None,
                        sample_hash: str | None = None, text_removal_info: dict | None = None,
                        original: np.ndarray | None = None) -> VerificationLog:
    """Screens one questioned image against a client's static references."""
    engine = get_engine()
    profiles = active_profiles(db, client.id, "static")
    if not profiles:
        raise HTTPException(409, f"{client.client_code} has no static references on file yet.")
    # v8.22: compare the questioned signature's size with the references' (display
    # only), then match the size only if an admin switched it on (default off).
    ref_widths = [_reference_width(p) for p in profiles]
    capture_info = capture.capture_check(capture.signature_width(img), ref_widths)
    size_match_on = bool(get_setting(db, "screening").get("size_match"))
    size_scale = 1.0
    if size_match_on:
        img, size_scale = capture.match_size(img, ref_widths)
    q = static_quality(img)
    if not q["usable"]:
        raise HTTPException(422, " ".join(q["issues"]))
    test = engine.static_embedding(img)
    refs = [np.array(p.embedding) for p in profiles]
    decision = dec.screen_static_embedding(test, refs, engine.static_cfg, MIN_ADAPTIVE_SAMPLES)
    classifier = _client_classifier(db, client.id, test, refs, decision, engine.static_cfg)
    per_ref, best = _per_ref(test, profiles)
    analysis = {
        "quality": q,
        "size_scale": round(size_scale, 3),
        "size_match": {"enabled": size_match_on, "scale": round(size_scale, 3)},
        "capture": capture_info,
        "client_classifier": classifier,
        "text_removal": _text_removal_record(text_removal_info, original, client.id),
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


def _text_removal_record(info: dict | None, original: np.ndarray | None, client_id: int) -> dict | None:
    """v8.21: what the remover did. When it changed the photo the original is
    stored too, so the examiner can always compare (the hash is of the upload)."""
    if not info:
        return None
    out = dict(info)
    if info.get("removed") and original is not None:
        out["original_path"] = save_image(original, f"questioned/static/{client_id}")
    return out


@router.post("/api/screen/static")
async def screen_static(
    file: UploadFile = File(...),
    client_id: int = Form(...),
    case_id: int | None = Form(None),
    document_ref: str | None = Form(None),
    expected_label: str | None = Form(None),
    remove_text: bool = Form(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    client = visible_client_or_404(db, client_id, user)
    case = _check_case(db, case_id, client.id, user)
    kept: dict = {}
    img = await _questioned_upload(file, remove_text, kept)
    log = screen_static_image(db, user, client, img, case, document_ref, _expected(expected_label),
                              sample_hash=hashlib.sha256(kept["data"]).hexdigest(),
                              text_removal_info=kept.get("info"), original=kept.get("raw"))
    return result_out(log, db, user)


# ----------------------------------------------------------------- dynamic ---

Strokes = list[list[dict]]


class DynamicScreenIn(BaseModel):
    test: Strokes
    client_id: int
    case_id: int | None = None
    document_ref: str | None = None
    expected_label: str | None = None


def _dyn_points(strokes: Strokes) -> np.ndarray:
    try:
        return points_from_payload(strokes)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, str(e) if isinstance(e, ValueError) else "Malformed stroke data.")


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
    pts = _dyn_points(body.test)
    try:
        # v8.11: compared on the pen data both sides have (routers/pen_data.py)
        test, pairs, mode, test_missing, cfg = pen_data.compare_set(pts, profiles)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not pairs:
        raise HTTPException(409, f"{client.client_code}'s dynamic references must be re-embedded on the computer "
                                 "that enrolled them (Admin, Re-embed references) before they can be compared.")
    profiles = [p for p, _ in pairs]
    refs = [e for _, e in pairs]
    decision = dec.screen_dynamic_embedding(test, refs, cfg, MIN_ADAPTIVE_SAMPLES)
    per_ref = [{"profile_id": p.id, "cosine": round(dec.pair_metrics(test, e)["cosine"], 4)} for p, e in pairs]
    best = max(per_ref, key=lambda r: r["cosine"])["profile_id"]
    pen_note = pen_data.screening_note(mode, test_missing, pairs)
    device = pen_data.LIMITED if pen_note else "standard"
    analysis = {
        "quality": q,
        "exact_match": _exact_match(test, refs, profiles),
        "per_reference": per_ref,
        "features": compare_features(dynamic_features(body.test), [p.features for p in profiles], "dynamic"),
        "pen_data": pen_note,
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
def questioned_image(log_id: int, view: str = Query("original", pattern="^(original|model)$"),
                     db: Session = Depends(get_db), user: User = Depends(require_result_viewer)):
    log = _visible_log(db, log_id, user)
    path = storage_path(log.test_sample_path) if log.modality == "static" else None
    if path is None:
        raise HTTPException(404, "The questioned image is not stored for this record.")
    if view == "model":  # display only, see common.model_view_png
        img = load_image(log.test_sample_path)
        if img is None:
            raise HTTPException(404, "The questioned image is not stored for this record.")
        return Response(model_view_png(img), media_type="image/png", headers=VIEW_ONLY_HEADERS)
    return FileResponse(path, media_type="image/png", headers=VIEW_ONLY_HEADERS)


@router.get("/api/verifications/{log_id}/original-image")
def questioned_original(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_result_viewer)):
    """v8.21: the photo as uploaded, before printed text was removed."""
    log = _visible_log(db, log_id, user)
    path = storage_path(((log.analysis or {}).get("text_removal") or {}).get("original_path"))
    if path is None:
        raise HTTPException(404, "No original photo: printed text was not removed for this record.")
    return FileResponse(path, media_type="image/png", headers=VIEW_ONLY_HEADERS)


@router.get("/api/verifications/{log_id}/strokes")
def questioned_strokes(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_result_viewer)):
    log = _visible_log(db, log_id, user)
    strokes = load_strokes(log.test_sample_path) if log.modality == "dynamic" else None
    if strokes is None:
        raise HTTPException(404, "The questioned strokes are not stored for this record.")
    return {"strokes": strokes}


def _overlay_images(db: Session, log_id: int, user: User) -> tuple[VerificationLog, np.ndarray, np.ndarray]:
    """The stored questioned image and its best-match reference (static only).
    Staff and the same record access as the result page (app/access.py)."""
    log = _visible_log(db, log_id, user)
    test_img = load_image(log.test_sample_path) if log.modality == "static" else None
    best = db.get(SignatureProfile, log.best_match_profile_id) if log.best_match_profile_id else None
    ref_img = load_image(best.sample_path) if best else None
    if test_img is None or ref_img is None:
        raise HTTPException(404, "The overlay needs the stored questioned image and its best-match reference.")
    return log, test_img, ref_img


# The overlay views below are view-only visual aids for the examiner: they
# change nothing (result, ledger, stored data) and are never downloadable.
@router.get("/api/verifications/{log_id}/overlay")
def difference_overlay(log_id: int, aligned: int = Query(1, ge=0, le=1),
                       db: Session = Depends(get_db), user: User = Depends(require_result_viewer)):
    _, test_img, ref_img = _overlay_images(db, log_id, user)
    return Response(content=overlay_png(test_img, ref_img, aligned=bool(aligned)), media_type="image/png",
                    headers=VIEW_ONLY_HEADERS)


@router.get("/api/verifications/{log_id}/feature-marks")
def feature_marks(log_id: int, db: Session = Depends(get_db), user: User = Depends(require_result_viewer)):
    """Where the handwriting features are on the questioned image and on its
    closest reference (each in its own pixels), plus which features were
    outside the client's usual range in this screening's feature analysis."""
    log, test_img, ref_img = _overlay_images(db, log_id, user)
    q, ref = static_feature_marks(test_img), static_feature_marks(ref_img)
    if q is None or ref is None:
        raise HTTPException(404, "No ink was found to mark on these images.")
    # The comparison made at screening time (compare_features), so this view
    # agrees with the Handwriting features tab.
    items = ((log.analysis or {}).get("features") or {}).get("items") or []
    outside = [{"name": i["name"], "label": i["label"]} for i in items if i.get("outside")]
    return JSONResponse({"questioned": q, "reference": ref, "outside": outside}, headers=VIEW_ONLY_HEADERS)
