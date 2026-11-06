"""ForgeBlock data collection tool (researchers only, separate from ForgeBlock).

Runs one ~15-minute session per participant:

  1. Paper: 20 genuine signatures on one 20-box sheet (scanned later).
  2. iPad: 20 genuine signatures.
  3. Paper: 20 forgeries of the assigned target on a second sheet.
  4. iPad: tracing practice over the target's signature (not saved), then 10 forgeries.

Dynamic signatures are written in the SVC2004 format, one file per signature:
U{user}S{n}.TXT, first line the number of points, then one point per line
"X Y TIME PEN AZIMUTH ALTITUDE PRESSURE". S1-S20 are the user's genuine
signatures and S21-S30 are forgeries OF that user made by another participant.
Scanned sheets are cut into labeled PNGs.

Data is stored under collector/data/ (or COLLECTOR_DATA; personal research
data, never commit it). Researcher pages need the researcher key:

    COLLECTOR_KEY=choose-a-passphrase uvicorn app:app --host 0.0.0.0 --port 8100

Remote participants never get the key. The researcher creates a personal link
per session (/p/#<token>, valid for a few days); the link can only add that
participant's own signatures and photos of their paper sheets, which wait for
the researcher's review in Sheet import.
"""
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import time
import zipfile
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import sheets
from cloud_sync import CloudSync

HERE = Path(__file__).resolve().parent
DATA = Path(os.getenv("COLLECTOR_DATA", HERE / "data")).resolve()
KEY = os.getenv("COLLECTOR_KEY") or secrets.token_urlsafe(9)
if not os.getenv("COLLECTOR_KEY"):
    print(f"\n  COLLECTOR_KEY not set. Researcher key for this run: {KEY}\n")
elif len(KEY) < 12:
    print("\n  WARNING: COLLECTOR_KEY is short. Use 12+ characters when the tool is online.\n")

GENUINE_DYNAMIC = 20
FORGED_DYNAMIC = 10
SHEET_BOXES = sheets.BOXES
CODE_RE = re.compile(r"^P(\d{3,4})$")
LINK_HOURS_MAX = 24 * 14

# Optional Supabase Storage mirror for hosts without a lasting disk (see cloud_sync.py).
SYNC = CloudSync(DATA)
if SYNC.enabled:
    print(f"  Restored {SYNC.restore()} files from Supabase Storage bucket '{SYNC.bucket}'.")

app = FastAPI(title="ForgeBlock data collection", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    res = await call_next(request)
    res.headers["X-Content-Type-Options"] = "nosniff"
    res.headers["X-Frame-Options"] = "DENY"
    res.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        res.headers["Cache-Control"] = "no-store"
    if request.headers.get("x-forwarded-proto") == "https":
        res.headers["Strict-Transport-Security"] = "max-age=31536000"
    return res


@app.middleware("http")
async def mirror_changes(request: Request, call_next):
    res = await call_next(request)
    if SYNC.enabled and request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith("/api/"):
        await run_in_threadpool(SYNC.push_or_retry)
    return res


# Failed researcher-key attempts per client address: 10 per 15 minutes, then 429.
FAILS: dict[str, deque] = defaultdict(deque)
FAIL_LIMIT, FAIL_WINDOW = 10, 15 * 60


def _too_many(ip: str) -> bool:
    q = FAILS[ip]
    while q and q[0] < time.monotonic() - FAIL_WINDOW:
        q.popleft()
    return len(q) >= FAIL_LIMIT


def require_key(request: Request, x_collector_key: str = Header(default="")) -> None:
    ip = request.client.host if request.client else "?"
    if _too_many(ip):
        raise HTTPException(429, "Too many wrong keys. Try again in 15 minutes.")
    if not hmac.compare_digest(x_collector_key.encode(), KEY.encode()):
        FAILS[ip].append(time.monotonic())
        raise HTTPException(401, "Wrong researcher key.")


# ------------------------------------------------------------------ store ---


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def user_no(code: str) -> int:
    return int(CODE_RE.match(code).group(1))


def pdir(code: str) -> Path:
    return DATA / "participants" / code


def load(code: str) -> dict:
    path = pdir(code) / "session.json"
    if not path.exists():
        raise HTTPException(404, f"No session for {code}.")
    return json.loads(path.read_text())


def save(p: dict) -> None:
    path = pdir(p["code"]) / "session.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, indent=2))
    tmp.replace(path)


def all_sessions() -> list[dict]:
    root = DATA / "participants"
    if not root.exists():
        return []
    return [json.loads(f.read_text()) for f in sorted(root.glob("P*/session.json"))]


def svc_path(user: int, n: int) -> Path:
    return DATA / "dynamic" / f"U{user}S{n}.TXT"


def static_dir(code: str, kind: str) -> Path:
    return DATA / "static" / code / kind


def progress(p: dict) -> dict:
    u = user_no(p["code"])
    genuine = sum(svc_path(u, n).exists() for n in range(1, GENUINE_DYNAMIC + 1))
    target = p.get("target")
    forged = 0
    if target:
        tu = user_no(target)
        forged = sum(svc_path(tu, n).exists() for n in range(21, 21 + FORGED_DYNAMIC))
    paper_g = len(list(static_dir(p["code"], "genuine").glob("*.png")))
    paper_f = len(list(static_dir(target, "forged").glob(f"*_by_{p['code']}.png"))) if target else 0
    return {
        "dynamic_genuine": genuine,
        "dynamic_forged": forged,
        "paper_genuine": paper_g,
        "paper_forged": paper_f,
        "forged_by": next((s["code"] for s in all_sessions() if s.get("target") == p["code"]), None),
    }


def session_out(p: dict) -> dict:
    out = {k: v for k, v in p.items() if k != "link"}
    link = p.get("link")
    out["link_expires_at"] = link["expires_at"] if link and not link_expired(link) else None
    out["pending_sheets"] = [k for k in ("genuine", "forged") if (staging(p["code"], k) / "boxes.json").exists()]
    return {**out, "user": user_no(p["code"]), "progress": progress(p)}


def link_expired(link: dict) -> bool:
    return datetime.fromisoformat(link["expires_at"]) <= datetime.now(timezone.utc)


def pick_target(code: str) -> str | None:
    """Earliest other participant with all 20 iPad genuine signatures and no forger yet."""
    taken = {s.get("target") for s in all_sessions()}
    for s in all_sessions():
        c = s["code"]
        if c == code or c in taken or s.get("withdrawn"):
            continue
        u = user_no(c)
        if all(svc_path(u, n).exists() for n in range(1, GENUINE_DYNAMIC + 1)):
            return c
    return None


# ---------------------------------------------------------------- sessions ---


class NewSession(BaseModel):
    code: str = Field(pattern=CODE_RE.pattern)
    consent: bool
    researcher: str = Field(min_length=1, max_length=60)


@app.get("/api/sessions", dependencies=[Depends(require_key)])
def list_sessions():
    sessions = [session_out(s) for s in all_sessions()]
    used = [user_no(s["code"]) for s in sessions]
    return {"sessions": sessions, "next_code": f"P{(max(used) + 1 if used else 1):03d}"}


@app.post("/api/sessions", dependencies=[Depends(require_key)])
def create_session(body: NewSession):
    if not body.consent:
        raise HTTPException(400, "Consent must be confirmed before the session starts.")
    if (pdir(body.code) / "session.json").exists():
        raise HTTPException(409, f"{body.code} already has a session.")
    p = {"code": body.code, "consent_at": now(), "researcher": body.researcher, "created_at": now(), "target": pick_target(body.code), "notes": ""}
    save(p)
    return session_out(p)


@app.get("/api/sessions/{code}", dependencies=[Depends(require_key)])
def get_session(code: str):
    return session_out(load(code))


@app.post("/api/sessions/{code}/assign-target", dependencies=[Depends(require_key)])
def assign_target(code: str):
    """Assign a forgery target later, e.g. for early participants who had none."""
    p = load(code)
    if p.get("target"):
        return session_out(p)
    p["target"] = pick_target(code)
    if not p["target"]:
        raise HTTPException(409, "No participant is ready to be a forgery target yet (needs 20 iPad genuine signatures and no forger).")
    save(p)
    return session_out(p)


class Notes(BaseModel):
    notes: str = Field(max_length=2000)


@app.put("/api/sessions/{code}/notes", dependencies=[Depends(require_key)])
def set_notes(code: str, body: Notes):
    p = load(code)
    p["notes"] = body.notes
    save(p)
    return session_out(p)


@app.post("/api/sessions/{code}/withdraw", dependencies=[Depends(require_key)])
def withdraw(code: str):
    """Participant withdrew consent: delete all their signature data, keep only the code as withdrawn."""
    p = load(code)
    u = user_no(code)
    for n in range(1, 41):
        svc_path(u, n).unlink(missing_ok=True)
        (DATA / "dynamic" / "meta" / f"U{u}S{n}.json").unlink(missing_ok=True)
    shutil.rmtree(DATA / "static" / code, ignore_errors=True)
    for k in ("genuine", "forged"):
        shutil.rmtree(staging(code, k), ignore_errors=True)
    p.pop("link", None)
    if p.get("target"):  # forgeries this participant made of someone else
        tu = user_no(p["target"])
        for n in range(21, 21 + FORGED_DYNAMIC):
            meta = DATA / "dynamic" / "meta" / f"U{tu}S{n}.json"
            if meta.exists() and json.loads(meta.read_text()).get("by") == code:
                svc_path(tu, n).unlink(missing_ok=True)
                meta.unlink()
        for f in static_dir(p["target"], "forged").glob(f"*_by_{code}.png"):
            f.unlink()
    p.update(withdrawn=True, withdrawn_at=now(), target=None)
    save(p)
    return session_out(p)


# ----------------------------------------------------------------- dynamic ---


class Point(BaseModel):
    x: float
    y: float
    t: float
    pen: int = Field(ge=0, le=1)
    azimuth: float = Field(ge=0, le=360)
    altitude: float = Field(ge=0, le=90)
    pressure: float = Field(ge=0, le=1)


class Capture(BaseModel):
    kind: str = Field(pattern="^(genuine|forged)$")
    points: list[Point] = Field(min_length=10, max_length=20000)
    height: float = Field(gt=0)  # canvas height, used to flip y (SVC2004 y points up)
    pointer: str = "pen"


def to_svc(points: list[Point], height: float) -> str:
    t0 = points[0].t
    lines = [str(len(points))]
    for p in points:
        lines.append(
            " ".join(
                str(v)
                for v in (
                    round(p.x * 10),  # 1/10 CSS pixel
                    round((height - p.y) * 10),
                    round(p.t - t0),  # ms from the first point
                    p.pen,
                    # tenths of a degree, 0-3599, clockwise from 12 o'clock like SVC2004
                    # (Pointer Events measure azimuth from 3 o'clock)
                    round(((p.azimuth + 90) % 360) * 10) % 3600,
                    round(p.altitude * 10),  # tenths of a degree, 0-900
                    round(p.pressure * 1023),  # 0-1023
                )
            )
        )
    return "\n".join(lines) + "\n"


@app.post("/api/sessions/{code}/dynamic", dependencies=[Depends(require_key)])
def save_dynamic(code: str, body: Capture):
    return do_save_dynamic(load(code), body)


def do_save_dynamic(p: dict, body: Capture) -> dict:
    code = p["code"]
    if p.get("withdrawn"):
        raise HTTPException(409, "This participant withdrew.")
    if sum(pt.pen for pt in body.points) < 10:
        raise HTTPException(400, "The signature is too short. Please sign again.")
    if body.kind == "genuine":
        user, slots = user_no(code), range(1, GENUINE_DYNAMIC + 1)
    else:
        if not p.get("target"):
            raise HTTPException(409, "No forgery target assigned.")
        user, slots = user_no(p["target"]), range(21, 21 + FORGED_DYNAMIC)
    n = next((s for s in slots if not svc_path(user, s).exists()), None)
    if n is None:
        raise HTTPException(409, "All signatures of this kind are already saved.")
    path = svc_path(user, n)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_svc(body.points, body.height))
    meta = DATA / "dynamic" / "meta" / f"{path.stem}.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"file": path.name, "by": code, "kind": body.kind, "pointer": body.pointer, "saved_at": now()}))
    return {"file": path.name, "session": session_out(p)}


@app.delete("/api/sessions/{code}/dynamic/last", dependencies=[Depends(require_key)])
def undo_dynamic(code: str, kind: str):
    """Delete the most recent signature of this kind (e.g. the participant was interrupted)."""
    return do_undo_dynamic(load(code), kind)


def do_undo_dynamic(p: dict, kind: str) -> dict:
    code = p["code"]
    if kind == "genuine":
        user, slots = user_no(code), range(GENUINE_DYNAMIC, 0, -1)
    else:
        if not p.get("target"):
            raise HTTPException(409, "No forgery target assigned.")
        user, slots = user_no(p["target"]), range(20 + FORGED_DYNAMIC, 20, -1)
    n = next((s for s in slots if svc_path(user, s).exists()), None)
    if n is None:
        raise HTTPException(404, "Nothing to undo.")
    svc_path(user, n).unlink()
    (DATA / "dynamic" / "meta" / f"U{user}S{n}.json").unlink(missing_ok=True)
    return {"deleted": f"U{user}S{n}.TXT", "session": session_out(p)}


@app.get("/api/sessions/{code}/reference", dependencies=[Depends(require_key)])
def target_reference(code: str):
    """The target's first iPad genuine signature as points, for the tracing practice and the reference view."""
    return do_reference(load(code))


def do_reference(p: dict) -> dict:
    if not p.get("target"):
        raise HTTPException(404, "No forgery target assigned.")
    path = svc_path(user_no(p["target"]), 1)
    if not path.exists():
        raise HTTPException(404, "The target has no iPad signature yet.")
    rows = [list(map(int, line.split())) for line in path.read_text().split("\n")[1:] if line.strip()]
    return {"target": p["target"], "points": [{"x": r[0] / 10, "y": r[1] / 10, "t": r[2], "pen": r[3], "pressure": r[6] / 1023} for r in rows]}


# ------------------------------------------------------------------ sheets ---


@app.get("/api/template", dependencies=[Depends(require_key)])
def template(participant: str = "", kind: str = "", target: str = "", fmt: str = "pdf"):
    if participant and not CODE_RE.match(participant):
        raise HTTPException(400, "Participant code looks like P001.")
    img = sheets.render_template(participant=participant, kind=kind if kind in ("genuine", "forgery") else "", target=target)
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, "PNG", dpi=(sheets.PRINT_DPI, sheets.PRINT_DPI))
        media = "image/png"
    else:
        img.save(buf, "PDF", resolution=sheets.PRINT_DPI)
        media = "application/pdf"
    name = f"sheet-{participant or 'blank'}-{kind or 'any'}.{fmt}"
    return Response(buf.getvalue(), media_type=media, headers={"Content-Disposition": f'inline; filename="{name}"'})


def staging(code: str, kind: str) -> Path:
    return DATA / "staging" / f"{code}-{kind}"


@app.post("/api/sheets/preview", dependencies=[Depends(require_key)])
async def sheet_preview(code: str = Form(...), kind: str = Form(...), scan: UploadFile = File(...)):
    """Straighten and crop a scanned sheet into a staging folder for the researcher to check."""
    return await do_sheet_preview(load(code), kind, scan, source="researcher")


async def do_sheet_preview(p: dict, kind: str, scan: UploadFile, source: str) -> dict:
    code = p["code"]
    if p.get("withdrawn"):
        raise HTTPException(409, "This participant withdrew.")
    if kind not in ("genuine", "forged"):
        raise HTTPException(400, "Sheet kind is genuine or forged.")
    if kind == "forged" and not p.get("target"):
        raise HTTPException(409, f"{code} has no forgery target.")
    data = await scan.read()
    if len(data) > 40 * 1024 * 1024:
        raise HTTPException(413, "Scan is larger than 40 MB.")
    try:
        sheet, boxes = sheets.import_sheet(data)
    except sheets.SheetError as e:
        raise HTTPException(422, str(e)) from e
    folder = staging(code, kind)
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    cv2.imwrite(str(folder / "sheet.png"), cv2.resize(sheet, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
    for b in boxes:
        cv2.imwrite(str(folder / f"box{b['index']:02d}.png"), b["image"])
    out = {"boxes": [{"index": b["index"], "ink": round(b["ink"], 4), "empty": b["empty"]} for b in boxes]}
    (folder / "boxes.json").write_text(json.dumps({**out, "source": source, "uploaded_at": now()}))
    return out


@app.get("/api/sheets/pending", dependencies=[Depends(require_key)])
def sheets_pending():
    """Sheet photos waiting for review (uploaded by remote participants, or previews never saved)."""
    out = []
    for f in sorted((DATA / "staging").glob("*/boxes.json")):
        code, kind = f.parent.name.rsplit("-", 1)
        out.append({"code": code, "kind": kind, **json.loads(f.read_text())})
    return {"pending": out}


@app.delete("/api/sheets/staging/{code}/{kind}", dependencies=[Depends(require_key)])
def sheet_discard(code: str, kind: str):
    if not CODE_RE.match(code) or kind not in ("genuine", "forged"):
        raise HTTPException(404)
    shutil.rmtree(staging(code, kind), ignore_errors=True)
    return {"ok": True}


@app.get("/api/sheets/staging/{code}/{kind}/{name}", dependencies=[Depends(require_key)])
def staging_file(code: str, kind: str, name: str):
    if not re.fullmatch(r"(sheet|box\d{2})\.png", name) or not CODE_RE.match(code) or kind not in ("genuine", "forged"):
        raise HTTPException(404)
    path = staging(code, kind) / name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


class SheetSave(BaseModel):
    code: str = Field(pattern=CODE_RE.pattern)
    kind: str = Field(pattern="^(genuine|forged)$")
    keep: list[int]


@app.post("/api/sheets/save", dependencies=[Depends(require_key)])
def sheet_save(body: SheetSave):
    """Move the checked crops into the dataset with their labels."""
    p = load(body.code)
    folder = staging(body.code, body.kind)
    if not folder.exists():
        raise HTTPException(404, "Upload the scan again; the preview expired.")
    if body.kind == "genuine":
        dest, owner = static_dir(body.code, "genuine"), body.code
        name = lambda i: f"{owner}_G{i:02d}.png"  # noqa: E731
    else:
        owner = p["target"]
        dest = static_dir(owner, "forged")
        name = lambda i: f"{owner}_F{i:02d}_by_{body.code}.png"  # noqa: E731
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for i in sorted(set(body.keep)):
        src = folder / f"box{i:02d}.png"
        if 1 <= i <= SHEET_BOXES and src.exists():
            shutil.copyfile(src, dest / name(i))
            saved.append(name(i))
    shutil.rmtree(folder, ignore_errors=True)
    return {"saved": saved, "session": session_out(p)}


# ------------------------------------------------------ participant links ---


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LinkIn(BaseModel):
    hours: int = Field(default=72, ge=1, le=LINK_HOURS_MAX)


@app.post("/api/sessions/{code}/link", dependencies=[Depends(require_key)])
def create_link(code: str, body: LinkIn):
    """Personal link for a remote participant. Creating a new link replaces the old one."""
    p = load(code)
    if p.get("withdrawn"):
        raise HTTPException(409, "This participant withdrew.")
    token = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(hours=body.hours)
    p["link"] = {"hash": token_hash(token), "created_at": now(), "expires_at": expires.isoformat(timespec="seconds")}
    p.pop("finished_at", None)
    save(p)
    # The token goes after '#', so browsers never send it to the server in URLs or logs.
    return {"path": f"/p/#{token}", "expires_at": p["link"]["expires_at"], "session": session_out(p)}


@app.delete("/api/sessions/{code}/link", dependencies=[Depends(require_key)])
def revoke_link(code: str):
    p = load(code)
    p.pop("link", None)
    save(p)
    return session_out(p)


def participant(request: Request, x_participant_token: str = Header(default="")) -> dict:
    ip = request.client.host if request.client else "?"
    if _too_many(ip):
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    if x_participant_token:
        h = token_hash(x_participant_token)
        for p in all_sessions():
            link = p.get("link")
            if link and hmac.compare_digest(link["hash"], h) and not p.get("withdrawn"):
                if link_expired(link):
                    raise HTTPException(410, "This link has expired. Please ask the researcher for a new one.")
                return p
    FAILS[ip].append(time.monotonic())
    raise HTTPException(401, "This link is not valid. Please ask the researcher for a new one.")


def participant_out(p: dict) -> dict:
    """What the participant's own page may see: no researcher notes, no other participants' codes."""
    pr = progress(p)
    return {
        "code": p["code"],
        "has_target": bool(p.get("target")),
        "expires_at": p["link"]["expires_at"],
        "progress": {k: pr[k] for k in ("dynamic_genuine", "dynamic_forged", "paper_genuine", "paper_forged")},
        "sheets_uploaded": {k: (staging(p["code"], k) / "boxes.json").exists() or bool(p.get("uploads", {}).get(k)) for k in ("genuine", "forged")},
        "finished": bool(p.get("finished_at")),
    }


@app.get("/api/p/session")
def p_session(p: dict = Depends(participant)):
    return participant_out(p)


@app.post("/api/p/dynamic")
def p_dynamic(body: Capture, p: dict = Depends(participant)):
    if body.pointer != "pen":
        raise HTTPException(400, "Please sign with the Apple Pencil, not a finger.")
    r = do_save_dynamic(p, body)
    return {"file": r["file"], "session": participant_out(p)}


@app.delete("/api/p/dynamic/last")
def p_undo(kind: str, p: dict = Depends(participant)):
    do_undo_dynamic(p, kind)
    return participant_out(p)


@app.get("/api/p/reference")
def p_reference(p: dict = Depends(participant)):
    r = do_reference(p)
    return {"points": r["points"]}


@app.get("/api/p/template")
def p_template(kind: str, p: dict = Depends(participant)):
    if kind not in ("genuine", "forgery") or (kind == "forgery" and not p.get("target")):
        raise HTTPException(404)
    img = sheets.render_template(participant=p["code"], kind=kind, target=p.get("target") or "")
    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=sheets.PRINT_DPI)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="sheet-{kind}.pdf"'})


@app.post("/api/p/sheet")
async def p_sheet(kind: str = Form(...), scan: UploadFile = File(...), p: dict = Depends(participant)):
    """Photo of a filled sheet. It is cropped into staging and waits for the researcher's review."""
    r = await do_sheet_preview(p, kind, scan, source="participant")
    p.setdefault("uploads", {})[kind] = now()
    save(p)
    return {"boxes_found": sum(not b["empty"] for b in r["boxes"]), "session": participant_out(p)}


@app.post("/api/p/finish")
def p_finish(p: dict = Depends(participant)):
    """Participant is done: the link stops working."""
    p["finished_at"] = now()
    p.pop("link", None)
    save(p)
    return {"ok": True}


# ------------------------------------------------------------------ export ---


@app.get("/api/export", dependencies=[Depends(require_key)])
def export():
    """Zip of the dataset: dynamic/UxSy.TXT, static/<code>/{genuine,forged}/*.png and manifest.csv."""
    buf = io.BytesIO()
    rows = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((DATA / "dynamic").glob("U*S*.TXT")):
            meta_path = DATA / "dynamic" / "meta" / f"{f.stem}.json"
            meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
            m = re.match(r"U(\d+)S(\d+)", f.stem)
            u, n = int(m.group(1)), int(m.group(2))
            z.write(f, f"dynamic/{f.name}")
            rows.append(["dynamic", f"dynamic/{f.name}", f"P{u:03d}", "genuine" if n <= 20 else "forged", meta.get("by", ""), meta.get("pointer", "")])
        for f in sorted((DATA / "static").glob("*/*/*.png")):
            owner, kind = f.parent.parent.name, f.parent.name
            by = f.stem.split("_by_")[1] if "_by_" in f.stem else owner
            z.write(f, f"static/{owner}/{kind}/{f.name}")
            rows.append(["static", f"static/{owner}/{kind}/{f.name}", owner, kind, by, "paper"])
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["modality", "file", "signature_of", "label", "written_by", "capture"])
        w.writerows(rows)
        z.writestr("manifest.csv", out.getvalue())
        z.writestr(
            "README.txt",
            "ForgeBlock research dataset. Personal data under the study's consent terms: keep on the secured research device.\n"
            "dynamic/UxSy.TXT: SVC2004 format. First line = number of points; then X Y TIME PEN AZIMUTH ALTITUDE PRESSURE.\n"
            "  X, Y in 1/10 CSS pixel (Y points up), TIME in ms from the first point, PEN 1 = touching, 0 = hovering,\n"
            "  AZIMUTH 0-3599 (clockwise from 12 o'clock) and ALTITUDE 0-900 (900 = upright) in tenths of a degree, PRESSURE 0-1023.\n"
            "  S1-S20 genuine signatures of user x; S21-S30 forgeries of user x made by another participant (see manifest).\n"
            "static/<code>/genuine/<code>_Gnn.png: box nn of the participant's genuine sheet.\n"
            "static/<code>/forged/<code>_Fnn_by_<forger>.png: box nn of a forgery sheet imitating <code>.\n",
        )
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="forgeblock-dataset-{stamp}.zip"'})


@app.get("/api/check-key", dependencies=[Depends(require_key)])
def check_key():
    return {"ok": True}


app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="static")
