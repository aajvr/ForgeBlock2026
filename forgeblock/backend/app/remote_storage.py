"""v8.24: shared sample storage in Supabase Storage (private bucket).

Every computer keeps its own backend/storage folder as a cache, but the bucket
is the shared copy: services.save_* upload each new file, services.storage_path
downloads a file this PC does not have yet, and services.delete_file removes it
from the bucket too. Enabled only when SUPABASE_URL and SUPABASE_SERVICE_KEY are
set; otherwise every function here is a no-op and storage stays local.

The service key never leaves the backend: the browser still gets images only
through the app's own view-only endpoints (no public bucket, no signed URLs).
"""
import logging
import time
from pathlib import Path
from urllib.parse import quote

from .config import SUPABASE_BUCKET, SUPABASE_SERVICE_KEY, SUPABASE_URL

log = logging.getLogger("forgeblock.storage")

_TIMEOUT = 20.0
_MISS_TTL = 60.0  # seconds a "not in the bucket" answer is remembered
_misses: dict[str, float] = {}
_bucket_ready = False


def enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_SERVICE_KEY}
    # Legacy service_role keys are JWTs and go in Authorization as well; the new
    # sb_secret_ keys are accepted from the apikey header alone.
    if SUPABASE_SERVICE_KEY.startswith("eyJ"):
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_KEY}"
    if extra:
        h.update(extra)
    return h


def _object_url(rel: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{quote(rel)}"


def _content_type(rel: str) -> str:
    return {"png": "image/png", "json": "application/json", "jpg": "image/jpeg",
            "jpeg": "image/jpeg"}.get(rel.rsplit(".", 1)[-1].lower(), "application/octet-stream")


def _client():
    import httpx

    return httpx.Client(timeout=_TIMEOUT)


def ensure_bucket() -> bool:
    """Create the private bucket once if it does not exist yet."""
    global _bucket_ready
    if not enabled() or _bucket_ready:
        return _bucket_ready
    try:
        with _client() as c:
            r = c.get(f"{SUPABASE_URL}/storage/v1/bucket/{SUPABASE_BUCKET}", headers=_headers())
            if r.status_code == 200:
                _bucket_ready = True
            else:
                r = c.post(f"{SUPABASE_URL}/storage/v1/bucket", headers=_headers(),
                           json={"id": SUPABASE_BUCKET, "name": SUPABASE_BUCKET, "public": False})
                _bucket_ready = r.status_code in (200, 201) or "already exists" in r.text.lower()
                if not _bucket_ready:
                    log.warning("Supabase Storage: could not create bucket %s: %s %s",
                                SUPABASE_BUCKET, r.status_code, r.text[:200])
    except Exception as e:  # network problems must never break a screening
        log.warning("Supabase Storage unreachable: %s", e)
    return _bucket_ready


def upload(rel: str, path: Path, overwrite: bool = True) -> str:
    """Upload one local file. Returns 'uploaded', 'exists', 'off' or 'failed'."""
    if not enabled():
        return "off"
    ensure_bucket()
    try:
        with _client() as c:
            r = c.post(_object_url(rel), content=path.read_bytes(),
                       headers=_headers({"Content-Type": _content_type(rel),
                                         "x-upsert": "true" if overwrite else "false"}))
        if r.status_code in (200, 201):
            _misses.pop(rel, None)
            return "uploaded"
        if r.status_code in (400, 409) and ("exists" in r.text.lower() or "duplicate" in r.text.lower()):
            return "exists"
        log.warning("Supabase Storage upload failed for %s: %s %s", rel, r.status_code, r.text[:200])
    except Exception as e:
        log.warning("Supabase Storage upload failed for %s: %s", rel, e)
    return "failed"


def download(rel: str, dest: Path) -> bool:
    """Fetch one file from the bucket into the local cache. False if missing."""
    if not enabled():
        return False
    if time.monotonic() - _misses.get(rel, -1e9) < _MISS_TTL:
        return False
    try:
        with _client() as c:
            r = c.get(_object_url(rel), headers=_headers())
        if r.status_code == 200:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(r.content)
            tmp.replace(dest)
            return True
        _misses[rel] = time.monotonic()
        if r.status_code not in (400, 404):
            log.warning("Supabase Storage download failed for %s: %s %s", rel, r.status_code, r.text[:200])
    except Exception as e:
        _misses[rel] = time.monotonic()
        log.warning("Supabase Storage download failed for %s: %s", rel, e)
    return False


def delete(rel: str) -> None:
    if not enabled():
        return
    try:
        with _client() as c:
            c.request("DELETE", f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}",
                      headers=_headers(), json={"prefixes": [rel]})
    except Exception as e:
        log.warning("Supabase Storage delete failed for %s: %s", rel, e)
