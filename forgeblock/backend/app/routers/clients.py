"""Client registry and signature cards (reference enrollment)."""
import re
from datetime import timedelta

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import (
    can_edit_client,
    editable_client_or_404,
    is_admin,
    own_cases,
    own_logs,
    visible_client_ids,
    visible_client_or_404,
)
from ..config import MAX_REFERENCES
from ..database import get_db
from ..ml.dynamic_features import points_from_payload
from ..ml import enroll_sheet
from ..ml.capture import standardize
from ..ml.engine import get_engine
from ..ml.features import dynamic_features, static_features
from ..ml.quality import dynamic_quality, static_quality
from ..models import Case, Client, ClientAccess, ClientGroup, SignatureProfile, User, VerificationLog, utcnow
from ..security import hash_password, require_admin, require_staff, temporary_password
from ..services import (
    assigned_examiner_id,
    delete_file,
    get_setting,
    group_examiner_id,
    load_image,
    load_strokes,
    log_activity,
    next_code,
    notify,
    save_image,
    save_strokes,
    storage_path,
)
from . import pen_data
from .common import (
    VIEW_ONLY_HEADERS,
    active_profiles,
    client_out,
    consistency,
    log_out,
    model_cfg,
    model_view_png,
    names,
    profile_out,
    read_upload,
)

router = APIRouter(prefix="/api", tags=["clients"])


class ClientIn(BaseModel):
    # Optional label. Use a code, not a real name (Section 3.2.1: samples are
    # identified by code only). Defaults to the client code.
    full_name: str | None = Field(None, max_length=120)
    is_practice: bool = False
    notes: str | None = Field(None, max_length=2000)
    # v8: a client account is created automatically when an email is given.
    email: str | None = Field(None, max_length=160)
    # Admins choose the group (folder); an examiner's clients go into their own group.
    group_id: int | None = None


class ClientUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    notes: str | None = Field(None, max_length=2000)
    group_id: int | None = None  # admins only: move the client to another group
    remove_from_group: bool = False


class AccountIn(BaseModel):
    email: str = Field(max_length=160)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _next_client_account_code(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(User).where(User.account_code.like("CLU-%"))) or 0
    while True:
        n += 1
        code = f"CLU-{n:03d}"
        if not db.scalar(select(User.id).where(User.account_code == code)):
            return code


def create_client_account(db: Session, c: Client, email: str, actor: User) -> dict:
    """Creates the client's sign-in account with a temporary password (shown
    once). The client can also sign in with Microsoft or Google if this email
    is theirs there."""
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address for the client's account.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    if db.scalar(select(User).where(User.client_id == c.id, User.role == "client")):
        raise HTTPException(409, "This client already has an account.")
    temp = temporary_password()
    u = User(full_name=c.full_name, email=email, role="client", account_code=_next_client_account_code(db),
             password_hash=hash_password(temp), must_change_password=True, client_id=c.id)
    db.add(u)
    db.commit()
    log_activity(db, actor, "account", f"Created client account {u.account_code} ({email}) for {c.client_code}")
    return {"email": email, "account_code": u.account_code, "temporary_password": temp}


def _group_or_422(db: Session, group_id: int) -> ClientGroup:
    g = db.get(ClientGroup, group_id)
    if g is None:
        raise HTTPException(422, "That group does not exist.")
    return g


@router.get("/clients")
def list_clients(q: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    stmt = select(Client).where(Client.status == "active").order_by(Client.full_name)
    ids = visible_client_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Client.id.in_(ids))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Client.full_name).like(like), func.lower(Client.client_code).like(like)))
    return [{**client_out(c, db), "shared": not can_edit_client(user, c)} for c in db.scalars(stmt)]


@router.post("/clients")
def create_client(body: ClientIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    days = int(get_setting(db, "retention").get("days") or 0)
    # Test accounts only ever hold practice samples prepared by the researchers.
    practice = body.is_practice or user.is_test_account
    if is_admin(user):
        group_id = _group_or_422(db, body.group_id).id if body.group_id else None
    else:
        group_id = user.group_id  # examiners register clients into their own group
    if body.email and db.scalar(select(User).where(User.email == body.email.strip().lower())):
        raise HTTPException(409, "An account with this email already exists.")
    code = next_code(db, Client.client_code, "PR" if practice else "CL")
    c = Client(
        group_id=group_id,
        client_code=code,
        full_name=(body.full_name or "").strip() or code,
        is_practice=practice,
        notes=body.notes,
        created_by=user.id,
        retention_until=utcnow() + timedelta(days=days) if days else None,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    log_activity(db, user, "client", f"Registered client {c.client_code}{' (practice)' if c.is_practice else ''}")
    account = create_client_account(db, c, body.email, user) if body.email else None
    return {**client_out(c, db), "new_account": account}


@router.post("/clients/{client_id}/account")
def add_client_account(client_id: int, body: AccountIn, db: Session = Depends(get_db),
                       user: User = Depends(require_staff)):
    c = editable_client_or_404(db, client_id, user)
    return create_client_account(db, c, body.email, user)


@router.get("/clients/{client_id}")
def client_card(client_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    c = visible_client_or_404(db, client_id, user)
    out = client_out(c, db)
    out["can_edit"] = can_edit_client(user, c)
    out["shared_with_me"] = not can_edit_client(user, c)
    for modality in ("static", "dynamic"):
        profiles = active_profiles(db, c.id, modality)
        cons = consistency(profiles, modality)
        out[f"{modality}_references"] = [profile_out(p, cons) for p in profiles]
    cases = db.scalars(own_cases(select(Case).where(Case.client_id == c.id), user).order_by(Case.id.desc())).all()
    nm = names(db)
    out["cases"] = [{"id": k.id, "case_code": k.case_code, "title": k.title, "status": k.status,
                     "examiner_name": nm.get(k.examiner_id), "created_at": k.created_at} for k in cases]
    logs = db.scalars(own_logs(select(VerificationLog).where(VerificationLog.client_id == c.id), user)
                      .order_by(VerificationLog.id.desc()).limit(50)).all()
    out["checks"] = [log_out(l, db, nm) for l in logs]
    if is_admin(user):
        access = db.scalars(select(ClientAccess).where(ClientAccess.client_id == c.id)).all()
        users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([a.user_id for a in access])))}
        out["access"] = [{"user_id": a.user_id, "account_code": users[a.user_id].account_code,
                          "full_name": users[a.user_id].full_name} for a in access if a.user_id in users]
    return out


@router.patch("/clients/{client_id}")
def update_client(client_id: int, body: ClientUpdate, db: Session = Depends(get_db),
                  user: User = Depends(require_staff)):
    c = editable_client_or_404(db, client_id, user)
    if body.full_name is not None:
        c.full_name = body.full_name.strip()
    if body.notes is not None:
        c.notes = body.notes
    old_group = c.group_id
    if body.group_id is not None or body.remove_from_group:
        if not is_admin(user):
            raise HTTPException(403, "Only an administrator can move a client to another group.")
        c.group_id = None if body.remove_from_group else _group_or_422(db, body.group_id).id
    db.commit()
    log_activity(db, user, "client", f"Updated client {c.client_code}")
    if c.group_id != old_group:
        old_ex, new_ex = group_examiner_id(db, old_group), group_examiner_id(db, c.group_id)
        new_name = db.get(ClientGroup, c.group_id).name if c.group_id else "no group"
        if old_ex != new_ex:
            notify(db, [old_ex], f"{c.client_code} moved out of your group", link="/app/clients", type="client_moved",
                   body=f"{c.full_name} is now in {new_name}. You no longer see this client.",
                   entity_type="client", entity_id=c.id, exclude=user.id)
            notify(db, [new_ex], f"{c.client_code} moved into your group", link=f"/app/clients/{c.id}",
                   type="client_moved", body=f"{c.full_name} is now one of your clients.",
                   entity_type="client", entity_id=c.id, exclude=user.id)
    return client_out(c, db)


def delete_client_data(db: Session, c: Client) -> int:
    """Deletes a client's signature files and embeddings. Screening records and
    their ledger blocks stay (they hold hashes and scores only), so the chain
    stays valid."""
    removed = 0
    for p in db.scalars(select(SignatureProfile).where(SignatureProfile.client_id == c.id)):
        delete_file(p.sample_path)
        p.embedding = []
        p.features = {}
        p.status = "removed"
        removed += 1
    for l in db.scalars(select(VerificationLog).where(VerificationLog.client_id == c.id)):
        delete_file(l.test_sample_path)  # the path itself stays in the sealed record
        delete_file(((l.analysis or {}).get("text_removal") or {}).get("original_path"))  # v8.21
    c.status = "deleted"
    c.full_name = f"Deleted client {c.client_code}"
    c.notes = None
    db.commit()
    return removed


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = visible_client_or_404(db, client_id, admin)
    code = c.client_code
    removed = delete_client_data(db, c)
    log_activity(db, admin, "deletion", f"Deleted the signature data of client {code} ({removed} references)")
    return {"ok": True, "removed_references": removed}


# ------------------------------------------------------------- enrollment ---

def _room(db: Session, client_id: int, modality: str, adding: int) -> int:
    have = len(active_profiles(db, client_id, modality))
    if have + adding > MAX_REFERENCES:
        raise HTTPException(422, f"A client can have at most {MAX_REFERENCES} {modality} references "
                                 f"({have} on file).")
    return have


def _notify_references(db: Session, user: User, c: Client, n: int, modality: str) -> None:
    """Tell the client's examiner that references were added (not when they added them)."""
    notify(db, [assigned_examiner_id(db, c)], f"New references for {c.client_code}", link=f"/app/clients/{c.id}",
           type="enrollment", body=f"{n} {modality} reference signature{'s' if n != 1 else ''} added to {c.full_name}'s card.",
           entity_type="client", entity_id=c.id, exclude=user.id)


@router.post("/clients/{client_id}/static/enroll")
async def enroll_static(client_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db),
                        user: User = Depends(require_staff)):
    c = editable_client_or_404(db, client_id, user)
    if not files:
        raise HTTPException(422, "Add at least one signature image.")
    _room(db, c.id, "static", len(files))
    engine = get_engine()
    accepted, rejected = [], []
    for f in files:
        _, img = await read_upload(f)
        q = static_quality(img)
        if not q["usable"]:
            rejected.append({"file": f.filename, "issues": q["issues"]})
            continue
        p = SignatureProfile(
            client_id=c.id,
            modality="static",
            sample_path=save_image(img, f"profiles/static/{c.id}"),
            embedding=engine.static_embedding(img).tolist(),
            model_version=engine.static_cfg["model_version"],
            features=static_features(img),
            quality=q["score"],
            enrolled_by=user.id,
        )
        db.add(p)
        db.commit()
        accepted.append({"file": f.filename, "id": p.id, "quality": q["score"], "issues": q["issues"]})
    if accepted:
        log_activity(db, user, "enrollment", f"Added {len(accepted)} static reference(s) to {c.client_code}",
                     modality="static")
        _notify_references(db, user, c, len(accepted), "static")
    return {"accepted": accepted, "rejected": rejected, "client": client_out(c, db)}


@router.get("/clients/{client_id}/static/enrollment-sheet")
def static_enrollment_sheet(client_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    """Printable sheet for this client: 2 practice + 10 reference boxes (blank form, holds no signature data)."""
    c = editable_client_or_404(db, client_id, user)
    pdf = enroll_sheet.render_pdf(c.client_code)  # code only, never the name (Section 3.2.1)
    return Response(pdf, media_type="application/pdf",
                    headers={**VIEW_ONLY_HEADERS,
                             "Content-Disposition": f'inline; filename="enrollment-sheet-{c.client_code}.pdf"'})


@router.post("/clients/{client_id}/static/sheet-preview")
async def static_sheet_preview(client_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                               user: User = Depends(require_staff)):
    """Straightens a phone photo or scan of the enrollment sheet and returns the 10
    cropped boxes for review. Nothing is stored: the examiner picks the boxes to
    keep, and the page sends them to /static/enroll like any other upload."""
    import base64

    import cv2

    editable_client_or_404(db, client_id, user)
    _, img = await read_upload(file, standardized=False)  # the whole sheet, not one signature
    try:
        boxes = enroll_sheet.import_sheet(img)
    except enroll_sheet.SheetError as e:
        raise HTTPException(422, str(e))
    out = []
    for b in boxes:
        ok, png = cv2.imencode(".png", b["image"])
        view = None
        if not b["empty"]:
            # Display only: the cleaned view of the box after the same line erasing
            # every upload gets. The box image itself is what gets enrolled.
            bgr = standardize(cv2.cvtColor(b["image"], cv2.COLOR_GRAY2BGR))
            view = "data:image/png;base64," + base64.b64encode(model_view_png(bgr)).decode()
        q = {"usable": False, "score": 0.0, "issues": ["This box is empty."]} if b["empty"] \
            else static_quality(cv2.cvtColor(b["image"], cv2.COLOR_GRAY2BGR))
        if b.get("cut_off"):
            # A capture problem, not a judgement on the signature: left unticked, the examiner decides.
            q = {**q, "issues": ["The signature runs over the box border and may be cut off."] + list(q["issues"])}
        out.append({
            "index": b["index"],
            "image": "data:image/png;base64," + base64.b64encode(png.tobytes()).decode(),
            "model_view": view,
            "empty": b["empty"],
            "usable": bool(q["usable"]),
            "quality": q["score"],
            "issues": q["issues"],
            "cut_off": bool(b.get("cut_off")),
        })
    return {"boxes": out}


class DynamicEnrollIn(BaseModel):
    samples: list[list[list[dict]]] = Field(min_length=1, max_length=MAX_REFERENCES)


@router.post("/clients/{client_id}/dynamic/enroll")
def enroll_dynamic(client_id: int, body: DynamicEnrollIn, db: Session = Depends(get_db),
                   user: User = Depends(require_staff)):
    c = editable_client_or_404(db, client_id, user)
    _room(db, c.id, "dynamic", len(body.samples))
    engine = get_engine()
    accepted, rejected = [], []
    for i, strokes in enumerate(body.samples, start=1):
        q = dynamic_quality(strokes)
        if not q["usable"]:
            rejected.append({"file": f"Signature {i}", "issues": q["issues"]})
            continue
        try:
            pts = points_from_payload(strokes)
            pen = pen_data.enroll_payload(pts)
        except (ValueError, KeyError, TypeError) as e:
            rejected.append({"file": f"Signature {i}", "issues": [str(e) if isinstance(e, ValueError) else "Malformed stroke data."]})
            continue
        p = SignatureProfile(
            client_id=c.id,
            modality="dynamic",
            sample_path=save_strokes(strokes, f"profiles/dynamic/{c.id}"),
            embedding=pen["embedding"],
            model_version=engine.dynamic_cfg["model_version"],
            features={**dynamic_features(strokes), "_pen": pen["pen"]},
            quality=q["score"],
            capture_device=pen["capture_device"],
            enrolled_by=user.id,
        )
        db.add(p)
        db.commit()
        notice = pen_data.enroll_notice(pen["pen"]["missing"])
        accepted.append({"file": f"Signature {i}", "id": p.id, "quality": q["score"], "issues": q["issues"],
                         "capture_device": p.capture_device, "pen_missing": pen["pen"]["missing"],
                         "notice": notice})
    limited = [a for a in accepted if a.get("notice")]
    if accepted:
        log_activity(db, user, "enrollment", f"Added {len(accepted)} dynamic reference(s) to {c.client_code}",
                     modality="dynamic")
        _notify_references(db, user, c, len(accepted), "dynamic")
    return {"accepted": accepted, "rejected": rejected, "client": client_out(c, db),
            "limited_notice": (f"{len(limited)} of the saved signature(s) have no pen pressure or tilt and are "
                               f"labelled \"{pen_data.LIMITED_LABEL}\". Your saved signature or pen did not record "
                               "this pen data, so screenings with them compare shape and timing only."
                               if limited else None)}


def _profile(db: Session, profile_id: int, user: User, edit: bool = False) -> SignatureProfile:
    p = db.get(SignatureProfile, profile_id)
    if p is None or p.status != "active":
        raise HTTPException(404, "Reference not found.")
    try:
        (editable_client_or_404 if edit else visible_client_or_404)(db, p.client_id, user)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(404, "Reference not found.")
        raise
    return p


@router.delete("/references/{profile_id}")
def remove_reference(profile_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    p = _profile(db, profile_id, user, edit=True)
    p.status = "removed"
    db.commit()
    c = db.get(Client, p.client_id)
    log_activity(db, user, "enrollment", f"Removed {p.modality} reference #{p.id} from {c.client_code}",
                 modality=p.modality)
    return {"ok": True}


class BulkDeleteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=MAX_REFERENCES * 2)


@router.post("/clients/{client_id}/references/bulk-delete")
def bulk_remove_references(client_id: int, body: BulkDeleteIn, db: Session = Depends(get_db),
                           user: User = Depends(require_staff)):
    """Remove several references of one client at once (same rules as the
    single delete). Ids that are missing or belong to another client are
    reported in `failed` and nothing else changes for them."""
    c = editable_client_or_404(db, client_id, user)
    deleted, failed = [], []
    for pid in dict.fromkeys(body.ids):
        p = db.get(SignatureProfile, pid)
        if p is None or p.status != "active" or p.client_id != c.id:
            failed.append({"id": pid, "reason": "Reference not found."})
            continue
        p.status = "removed"
        deleted.append(p)
    db.commit()
    for modality in ("static", "dynamic"):
        n = sum(p.modality == modality for p in deleted)
        if n:
            log_activity(db, user, "enrollment", f"Removed {n} {modality} reference(s) from {c.client_code}",
                         modality=modality)
    return {"deleted": [p.id for p in deleted], "failed": failed}


@router.get("/references/{profile_id}/image")
def reference_image(profile_id: int, view: str = Query("original", pattern="^(original|model)$"),
                    db: Session = Depends(get_db), user: User = Depends(require_staff)):
    """Shown inside the app's viewer only. There is no download or export
    function (Section 3.8); the response is marked inline and not cached.
    view=model returns the cleaned 224 x 224 picture the model sees (display only)."""
    p = _profile(db, profile_id, user)
    path = storage_path(p.sample_path) if p.modality == "static" else None
    if path is None:
        raise HTTPException(404, "Image not available.")
    if view == "model":
        img = load_image(p.sample_path)
        if img is None:
            raise HTTPException(404, "Image not available.")
        return Response(model_view_png(img), media_type="image/png", headers=VIEW_ONLY_HEADERS)
    return FileResponse(path, media_type="image/png", headers=VIEW_ONLY_HEADERS)


@router.get("/references/{profile_id}/strokes")
def reference_strokes(profile_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    p = _profile(db, profile_id, user)
    strokes = load_strokes(p.sample_path) if p.modality == "dynamic" else None
    if strokes is None:
        raise HTTPException(404, "Strokes not available.")
    return {"strokes": strokes, "features": pen_data.public_features(p.features),
            "pen_missing": sorted(pen_data.ref_missing(p))}


@router.get("/models/reference-counts")
def reference_rules(user: User = Depends(require_staff)):
    from ..config import MIN_ADAPTIVE_SAMPLES, RECOMMENDED_REFERENCES

    return {
        "minimum": MIN_ADAPTIVE_SAMPLES,
        "recommended": RECOMMENDED_REFERENCES,
        "maximum": MAX_REFERENCES,
        "static_cosine_default": model_cfg("static")["thresholds"]["cosine"],
    }


def mean_embedding(profiles: list[SignatureProfile]) -> np.ndarray:
    return np.mean([np.asarray(p.embedding) for p in profiles], axis=0)
