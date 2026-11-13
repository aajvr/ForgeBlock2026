"""Helpers shared by the routers."""
from itertools import combinations

import numpy as np
from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..config import MAX_REFERENCES, MIN_ADAPTIVE_SAMPLES, RECOMMENDED_REFERENCES
from ..ml.engine import get_engine
from ..ml import capture
from ..ml.capture import standardize
from ..ml.preprocessing import decode_image, preprocessed_preview
from ..ml.screening import LABELS
from ..services import load_image
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


# v8.22: references that are all very alike (small spread of their reference-vs-reference
# cosine) give a strict personal threshold. On UTSig (115 people, v8.16, 9 day-1 references,
# day-3 genuine screened) people with spread < 0.06 had 28-29% of their other-day genuine
# signatures marked Inconsistent, against 9-10% for spread >= 0.08. Model-specific.
ALIKE_SPREAD = 0.06


def reference_spread(profiles: list[SignatureProfile]) -> float | None:
    """Standard deviation of the cosine similarity between every pair of references."""
    embs = [np.asarray(p.embedding, dtype=np.float64) for p in profiles if p.embedding is not None]
    if len(embs) < 3:
        return None
    e = np.stack(embs)
    e = e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-12)
    sims = (e @ e.T)[np.triu_indices(len(e), 1)]
    return float(sims.std())


def threshold_strength(count: int, sittings: int | None = None, spread: float | None = None) -> dict:
    """Signature card badge: personal threshold strength from the number of
    references (min 7, recommended 20, max 30). `sittings` is the rough number of
    sittings the references were added in (see sitting_count); when they all come from one
    sitting the note suggests adding more on another day (signatures vary from
    day to day, and screening is more reliable when the references show it)."""
    more = "More signatures make the screening more reliable."
    if count >= RECOMMENDED_REFERENCES:
        level, label = "strong", "Strong"
        note = f"{count} references. Personal threshold is well supported."
        if count < MAX_REFERENCES:
            note += f" Adding more (up to {MAX_REFERENCES}) can still help."
    elif count >= MIN_ADAPTIVE_SAMPLES:
        level, label = "basic", "Ready"
        note = (f"{count} references. Personal threshold is on. {more} "
                f"{RECOMMENDED_REFERENCES} or more is recommended.")
    elif count > 0:
        level, label = "not_ready", "Not ready"
        note = (f"{count} of {MIN_ADAPTIVE_SAMPLES} references. Default thresholds are used until "
                f"{MIN_ADAPTIVE_SAMPLES} are on file.")
    else:
        level, label, note = "none", "No references", "No references on file yet."
    sitting_tip = None
    if count > 0 and sittings == 1 and count < MAX_REFERENCES:
        sitting_tip = ("All references were signed in one sitting. If possible, add more signatures "
                       "on another day so the references show how the signature naturally varies.")
    alike_tip = None
    if count >= MIN_ADAPTIVE_SAMPLES and spread is not None and spread < ALIKE_SPREAD and count < MAX_REFERENCES:
        alike_tip = ("These references look very alike, as if signed in one sitting. That makes this client's "
                     "personal threshold strict, so their genuine signatures from another day may be marked "
                     "Inconsistent. Add 5 to 10 references signed on a different day, captured the same way "
                     "you capture questioned documents.")
        sitting_tip = None  # the alike tip says the same, with the reason
    return {"level": level, "label": label, "count": count, "note": note, "sittings": sittings,
            "sitting_tip": sitting_tip, "alike_tip": alike_tip,
            "spread": round(spread, 4) if spread is not None else None,
            "minimum": MIN_ADAPTIVE_SAMPLES, "recommended": RECOMMENDED_REFERENCES, "maximum": MAX_REFERENCES}


SITTING_GAP_HOURS = 6


def sitting_count(profiles: list[SignatureProfile]) -> int:
    """Rough number of sittings: references added more than SITTING_GAP_HOURS
    apart count as separate sittings (time zone does not matter this way)."""
    times = sorted(p.enrolled_at for p in profiles if p.enrolled_at)
    if not times:
        return 0
    return 1 + sum((b - a).total_seconds() > SITTING_GAP_HOURS * 3600 for a, b in zip(times, times[1:]))


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


# v8.23: per-reference capture check. Signature width of each stored static
# reference, cached by sample_path (a stored image never changes).
_REF_WIDTHS: dict[str, int | None] = {}


def reference_width(profile: SignatureProfile) -> int | None:
    """Signature width in pixels of a stored static reference (cached)."""
    key = profile.sample_path
    if key not in _REF_WIDTHS:
        img = load_image(key) if key else None
        _REF_WIDTHS[key] = capture.signature_width(img) if img is not None else None
    return _REF_WIDTHS[key]


def capture_flags(profiles: list[SignatureProfile]) -> dict[int, dict]:
    """{profile_id: {"flagged", "size_ratio", "acknowledged"}} for STATIC references:
    each reference's signature width against the median width of the client's
    OTHER active references (at least 3 references). Flagged beyond
    capture.CAPTURE_SIZE_LIMIT either way, unless the examiner chose to keep it
    (features["_capture_ack"]). Display only: never changes screening."""
    profiles = [p for p in profiles if p.modality == "static"]
    if len(profiles) < 3:
        return {}
    widths = {p.id: reference_width(p) for p in profiles}
    limit = capture.CAPTURE_SIZE_LIMIT
    out: dict[int, dict] = {}
    for p in profiles:
        own = widths[p.id]
        others = [w for i, w in widths.items() if i != p.id and w]
        if not own or not others:
            continue
        ratio = own / float(np.median(others))
        acked = bool((p.features or {}).get("_capture_ack"))
        out[p.id] = {"flagged": bool((ratio > limit or ratio < 1 / limit) and not acked),
                     "size_ratio": round(ratio, 2), "acknowledged": acked}
    return out


def profile_out(p: SignatureProfile, cons: dict | None = None, capture_flag: dict | None = None) -> dict:
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
        # v8.23: static only; None for dynamic or when it could not be checked.
        "capture_flag": capture_flag if p.modality == "static" else None,
    }


def group_examiner(db: Session, group_id: int | None) -> User | None:
    """The one examiner who handles a client group."""
    if not group_id:
        return None
    return db.scalar(select(User).where(User.group_id == group_id, User.role == "examiner",
                                        User.status == "active").order_by(User.id))


def examiner_ref(u: User | None) -> dict | None:
    return {"id": u.id, "full_name": u.full_name, "account_code": u.account_code} if u else None


def prefetch(db: Session, model, ids) -> dict:
    """{id: row} for these ids in one query. Keeping the dict alive also keeps the
    rows in the session, so later db.get() calls for them need no round trip."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {r.id: r for r in db.scalars(select(model).where(model.id.in_(ids)))}


def _client_batch(db: Session, clients: list[Client]) -> dict:
    """Everything client_out needs for many clients, in four queries instead of
    about five per client (each one a round trip to the database)."""
    ids = [c.id for c in clients]
    gids = {c.group_id for c in clients if c.group_id}
    profiles: dict[tuple[int, str], list[SignatureProfile]] = {}
    examiners: dict[int, User] = {}
    accounts: dict[int, User] = {}
    if ids:
        mv = {m: model_cfg(m)["model_version"] for m in ("static", "dynamic")}
        for p in db.scalars(
            select(SignatureProfile)
            .where(SignatureProfile.client_id.in_(ids), SignatureProfile.status == "active",
                   or_(*(and_(SignatureProfile.modality == m, SignatureProfile.model_version == v)
                         for m, v in mv.items())))
            .order_by(SignatureProfile.id)
        ):
            profiles.setdefault((p.client_id, p.modality), []).append(p)
        for u in db.scalars(select(User).where(User.client_id.in_(ids), User.role == "client").order_by(User.id)):
            accounts.setdefault(u.client_id, u)
    if gids:
        for u in db.scalars(select(User).where(User.group_id.in_(gids), User.role == "examiner",
                                               User.status == "active").order_by(User.id)):
            examiners.setdefault(u.group_id, u)
    return {"profiles": profiles, "groups": prefetch(db, ClientGroup, gids),
            "examiners": examiners, "accounts": accounts}


def clients_out(clients, db: Session) -> list[dict]:
    clients = list(clients)
    pre = _client_batch(db, clients)
    return [client_out(c, db, pre) for c in clients]


def client_out(c: Client, db: Session, pre: dict | None = None) -> dict:
    if pre is None:
        sp = active_profiles(db, c.id, "static")
        dp = active_profiles(db, c.id, "dynamic")
        g = db.get(ClientGroup, c.group_id) if c.group_id else None
        account = db.scalar(select(User).where(User.client_id == c.id, User.role == "client"))
        examiner = group_examiner(db, c.group_id)
    else:
        sp = pre["profiles"].get((c.id, "static"), [])
        dp = pre["profiles"].get((c.id, "dynamic"), [])
        g = pre["groups"].get(c.group_id)
        account = pre["accounts"].get(c.id)
        examiner = pre["examiners"].get(c.group_id)
    s, d = len(sp), len(dp)
    return {
        "group_id": c.group_id,
        "group_name": g.name if g else None,
        "assigned_examiner": examiner_ref(examiner),
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
        "static_strength": threshold_strength(s, sitting_count(sp), reference_spread(sp)),
        "dynamic_strength": threshold_strength(d, sitting_count(dp)),
    }


def names(db: Session) -> dict[int, str]:
    return {u.id: u.full_name for u in db.scalars(select(User))}


def latest_findings(db: Session, case_ids) -> dict[int, Finding]:
    """{case_id: its latest finding} in one query."""
    ids = {i for i in case_ids if i is not None}
    out: dict[int, Finding] = {}
    if ids:
        for f in db.scalars(select(Finding).where(Finding.case_id.in_(ids)).order_by(Finding.id)):
            out[f.case_id] = f  # ordered by id, so the last one wins
    return out


def logs_out(logs, db: Session, names_map: dict | None = None) -> list[dict]:
    """log_out for many screenings with a fixed number of queries."""
    logs = list(logs)
    names_map = names_map if names_map is not None else names(db)
    clients = prefetch(db, Client, (l.client_id for l in logs))
    cases = prefetch(db, Case, (l.case_id for l in logs))
    pre = {
        "clients": clients,
        "cases": cases,
        "users": prefetch(db, User, (l.performed_by for l in logs)),
        "groups": prefetch(db, ClientGroup, (c.group_id for c in clients.values())),
        "findings": latest_findings(db, (c.id for c in cases.values() if c.status != "open")),
    }
    return [log_out(l, db, names_map, pre) for l in logs]


def log_out(l: VerificationLog, db: Session, names_map: dict | None = None, pre: dict | None = None) -> dict:
    names_map = names_map if names_map is not None else names(db)
    finding = None
    if pre is None:
        client = db.get(Client, l.client_id) if l.client_id else None
        case = db.get(Case, l.case_id) if l.case_id else None
        performer = db.get(User, l.performed_by) if l.performed_by else None
        group = db.get(ClientGroup, client.group_id) if client is not None and client.group_id else None
        if case is not None and case.status != "open":
            f = db.scalar(select(Finding).where(Finding.case_id == case.id).order_by(Finding.id.desc()))
            finding = f.finding if f else None
    else:
        client = pre["clients"].get(l.client_id)
        case = pre["cases"].get(l.case_id)
        performer = pre["users"].get(l.performed_by)
        group = pre["groups"].get(client.group_id) if client is not None else None
        if case is not None and case.status != "open":
            f = pre["findings"].get(case.id)
            finding = f.finding if f else None
    return {
        "id": l.id,
        "receipt_code": l.receipt_code,
        "modality": l.modality,
        "mode": l.mode,
        "performed_by": l.performed_by,
        "performed_by_name": names_map.get(l.performed_by),
        "performed_by_code": performer.account_code if performer else None,
        "group_id": group.id if group else None,
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
