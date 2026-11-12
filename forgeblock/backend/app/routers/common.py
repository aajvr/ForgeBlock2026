"""Helpers shared by the routers."""
from itertools import combinations

import numpy as np
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import MAX_REFERENCES, MIN_ADAPTIVE_SAMPLES, RECOMMENDED_REFERENCES
from ..ml.engine import get_engine
from ..ml.capture import standardize
from ..ml.preprocessing import decode_image, preprocessed_preview
from ..ml.screening import LABELS
from ..models import Case, Client, ClientGroup, Finding, SignatureProfile, User, VerificationLog

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Signature images are for viewing inside the app only (Section 3.8: no
# download or export). Inline, never cached, never sniffed.
VIEW_ONLY_HEADERS = {
    "Cache-Control": "no-store, private",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
}


async def read_upload(upload: UploadFile, standardized: bool = True) -> tuple[bytes, np.ndarray]:
    """Read an uploaded static image. By default printed lines (box borders,
    ruled lines) are erased (app/ml/capture.py) so they are not mistaken for
    ink; references and questioned signatures get the same treatment."""
    data = await upload.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Images must be 10 MB or smaller.")
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return data, standardize(img) if standardized else img


def model_view_png(img: np.ndarray) -> bytes:
    """PNG of the cleaned 224 x 224 image the static model sees (display only;
    the model always gets the stored image, never this picture)."""
    import cv2

    ok, png = cv2.imencode(".png", cv2.cvtColor(preprocessed_preview(img), cv2.COLOR_RGB2BGR))
    return png.tobytes()


def model_cfg(modality: str) -> dict:
    e = get_engine()
    return e.static_cfg if modality == "static" else e.dynamic_cfg


def active_profiles(db: Session, client_id: int, modality: str) -> list[SignatureProfile]:
    """Active references embedded by the currently loaded model. References
    made with an older model are skipped until re-embedded (admin action)."""
    return list(
        db.scalars(
            select(SignatureProfile)
            .where(
                SignatureProfile.client_id == client_id,
                SignatureProfile.modality == modality,
                SignatureProfile.status == "active",
                SignatureProfile.model_version == model_cfg(modality)["model_version"],
            )
            .order_by(SignatureProfile.id)
        )
    )


def threshold_strength(count: int) -> dict:
    """Signature card badge: personal threshold strength from the number of
    references (min 7, recommended 10, max 20)."""
    if count >= RECOMMENDED_REFERENCES:
        level, label = "strong", "Strong"
        note = f"{count} references. Personal threshold is well supported."
    elif count >= MIN_ADAPTIVE_SAMPLES:
        level, label = "basic", "Ready"
        note = f"{count} references. Personal threshold is on; {RECOMMENDED_REFERENCES} or more is recommended."
    elif count > 0:
        level, label = "not_ready", "Not ready"
        note = (f"{count} of {MIN_ADAPTIVE_SAMPLES} references. Default thresholds are used until "
                f"{MIN_ADAPTIVE_SAMPLES} are on file.")
    else:
        level, label, note = "none", "No references", "No references on file yet."
    return {"level": level, "label": label, "count": count, "note": note,
            "minimum": MIN_ADAPTIVE_SAMPLES, "recommended": RECOMMENDED_REFERENCES, "maximum": MAX_REFERENCES}


def consistency(profiles: list[SignatureProfile], modality: str) -> dict[int, dict]:
    """How well each reference agrees with the client's other references.
    A reference is flagged when it is much less similar to the others than
    they are to each other (possibly a bad scan or a different signature)."""
    if len(profiles) < 3:
        return {p.id: {"score": None, "flagged": False} for p in profiles}
    emb = np.stack([np.asarray(p.embedding, dtype=np.float64) for p in profiles])
    emb = emb / (np.linalg.norm(emb, axis=1, keepdims=True) + 1e-12)
    sims = emb @ emb.T
    n = len(profiles)
    mean_to_others = (sims.sum(axis=1) - 1.0) / (n - 1)
    pair_vals = [sims[i, j] for i, j in combinations(range(n), 2)]
    mu, sd = float(np.mean(pair_vals)), float(np.std(pair_vals))
    floor = model_cfg(modality)["thresholds"]["cosine"]
    out = {}
    for p, m in zip(profiles, mean_to_others):
        flagged = bool(m < mu - 2.0 * max(sd, 0.01) or m < floor - 0.05)
        out[p.id] = {"score": round(float(m), 4), "flagged": flagged}
    return out


def profile_out(p: SignatureProfile, cons: dict | None = None) -> dict:
    c = (cons or {}).get(p.id, {})
    return {
        "id": p.id,
        "client_id": p.client_id,
        "modality": p.modality,
        "quality": p.quality,
        "consistency": c.get("score"),
        "flagged": c.get("flagged", False),
        "enrolled_at": p.enrolled_at,
        "capture_device": p.capture_device,
        "pen_label": "Limited pen data" if p.capture_device in ("limited", "development") else None,
        "pen_missing": sorted(((p.features or {}).get("_pen") or {}).get("missing") or
                              (["tilt"] if p.capture_device == "development" else [])),
        "status": p.status,
    }


def group_examiner(db: Session, group_id: int | None) -> User | None:
    """The one examiner who handles a client group."""
    if not group_id:
        return None
    return db.scalar(select(User).where(User.group_id == group_id, User.role == "examiner",
                                        User.status == "active").order_by(User.id))


def examiner_ref(u: User | None) -> dict | None:
    return {"id": u.id, "full_name": u.full_name, "account_code": u.account_code} if u else None


def client_out(c: Client, db: Session) -> dict:
    s = len(active_profiles(db, c.id, "static"))
    d = len(active_profiles(db, c.id, "dynamic"))
    g = db.get(ClientGroup, c.group_id) if c.group_id else None
    account = db.scalar(select(User).where(User.client_id == c.id, User.role == "client"))
    return {
        "group_id": c.group_id,
        "group_name": g.name if g else None,
        "assigned_examiner": examiner_ref(group_examiner(db, c.group_id)),
        "account": {"email": account.email, "account_code": account.account_code,
                    "status": account.status} if account else None,
        "id": c.id,
        "client_code": c.client_code,
        "full_name": c.full_name,
        "is_practice": c.is_practice,
        "notes": c.notes,
        "status": c.status,
        "deletion_requested": c.deletion_requested,
        "created_at": c.created_at,
        "retention_until": c.retention_until,
        "static_count": s,
        "dynamic_count": d,
        "static_strength": threshold_strength(s),
        "dynamic_strength": threshold_strength(d),
    }


def names(db: Session) -> dict[int, str]:
    return {u.id: u.full_name for u in db.scalars(select(User))}


def log_out(l: VerificationLog, db: Session, names_map: dict | None = None) -> dict:
    names_map = names_map if names_map is not None else names(db)
    client = db.get(Client, l.client_id) if l.client_id else None
    case = db.get(Case, l.case_id) if l.case_id else None
    performer = db.get(User, l.performed_by) if l.performed_by else None
    group = db.get(ClientGroup, client.group_id) if client is not None and client.group_id else None
    finding = None
    if case is not None and case.status != "open":
        f = db.scalar(select(Finding).where(Finding.case_id == case.id).order_by(Finding.id.desc()))
        finding = f.finding if f else None
    return {
        "id": l.id,
        "receipt_code": l.receipt_code,
        "modality": l.modality,
        "mode": l.mode,
        "performed_by": l.performed_by,
        "performed_by_name": names_map.get(l.performed_by),
        "performed_by_code": performer.account_code if performer else None,
        "group_name": group.name if group else None,
        "client_id": l.client_id,
        "client_code": client.client_code if client else None,
        "client_name": client.full_name if client else None,
        "case_id": l.case_id,
        "case_code": case.case_code if case else None,
        "case_status": case.status if case else None,
        "finding": finding,
        "document_ref": l.document_ref,
        "similarity_score": l.similarity_score,
        "confidence_score": l.confidence_score,
        "metrics": l.metrics,
        "thresholds": l.thresholds,
        "threshold_source": l.threshold_source,
        "screening_result": l.screening_result,
        "screening_label": LABELS.get(l.screening_result, l.screening_result),
        "expected_label": l.expected_label,
        "review_status": l.review_status,
        "capture_device": l.capture_device,
        "pen_label": "Limited pen data" if l.capture_device in ("limited", "development") else None,
        "reference_count": len(l.reference_profile_ids or []),
        "created_at": l.created_at,
    }


def get_client_or_404(db: Session, client_id: int) -> Client:
    c = db.get(Client, client_id)
    if c is None or c.status != "active":
        raise HTTPException(404, "Client not found.")
    return c


CLIENT_HIDDEN_FIELDS = ("metrics", "thresholds", "similarity_score", "expected_label", "review_status",
                        "performed_by", "threshold_source")


def client_safe(out: dict) -> dict:
    """What a client sees of a screening: the result, confidence, dates,
    receipt and the examiner's decision, not the model's internals."""
    for k in CLIENT_HIDDEN_FIELDS:
        out.pop(k, None)
    return out
