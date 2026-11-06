"""Optional mirror of the data folder to a private Supabase Storage bucket.

Free hosts (Render free, Vercel, ...) have no lasting disk: the folder is wiped
when the app sleeps or redeploys. With SUPABASE_URL and SUPABASE_SECRET_KEY set,
the collector:

  * on startup, downloads the whole bucket into the data folder (and refuses to
    start if that fails, so it never runs on an empty copy), and
  * after every request that changes data, uploads new or changed files and
    deletes removed ones before the response is sent. If Storage is briefly
    unreachable it retries in the background every 30 seconds until it works
    (and on every later change), and logs "SYNC FAILED".

Without those variables nothing happens and the data folder is the only copy
(normal local use).
"""
import json
import mimetypes
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class SyncError(RuntimeError):
    pass


class CloudSync:
    def __init__(self, data: Path):
        self.data = data
        self.url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self.bucket = os.getenv("SUPABASE_BUCKET", "collector-data")
        self.enabled = bool(self.url and self.key)
        self.lock = threading.Lock()
        self.known: dict[str, tuple[int, int]] = {}

    # ------------------------------------------------------------- http ---
    def _req(self, method: str, path: str, body: bytes | None = None, ctype: str | None = None, extra: dict | None = None) -> bytes:
        headers = {"apikey": self.key}
        if self.key.startswith("eyJ"):  # legacy JWT service_role key
            headers["Authorization"] = f"Bearer {self.key}"
        if ctype:
            headers["Content-Type"] = ctype
        headers.update(extra or {})
        req = urllib.request.Request(f"{self.url}/storage/v1/{path}", data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            raise SyncError(f"Supabase Storage {method} {path}: {e.code} {e.read()[:200]!r}") from e
        except OSError as e:
            raise SyncError(f"Supabase Storage unreachable: {e}") from e

    def _json(self, method: str, path: str, payload) -> object:
        return json.loads(self._req(method, path, json.dumps(payload).encode(), "application/json") or b"null")

    @staticmethod
    def _q(rel: str) -> str:
        return urllib.parse.quote(rel)

    # ------------------------------------------------------------ setup ---
    def ensure_bucket(self) -> None:
        try:
            self._req("GET", f"bucket/{self.bucket}")
        except SyncError:
            self._json("POST", "bucket", {"id": self.bucket, "name": self.bucket, "public": False})

    def list_all(self, prefix: str = "") -> list[str]:
        out, offset = [], 0
        while True:
            items = self._json("POST", f"object/list/{self.bucket}", {"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
            for it in items:
                full = f"{prefix}{it['name']}"
                if it.get("id") is None:  # folder
                    out += self.list_all(full + "/")
                else:
                    out.append(full)
            if len(items) < 1000:
                return out
            offset += 1000

    def restore(self) -> int:
        """Download every object into the data folder. Called once at startup."""
        if not self.enabled:
            return 0
        self.ensure_bucket()
        names = self.list_all()
        for rel in names:
            dest = self.data / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(self._req("GET", f"object/{self.bucket}/{self._q(rel)}"))
        self.known = self.scan()
        return len(names)

    # ------------------------------------------------------------- sync ---
    def scan(self) -> dict[str, tuple[int, int]]:
        out = {}
        if self.data.exists():
            for f in self.data.rglob("*"):
                if f.is_file() and not f.name.endswith(".tmp"):
                    st = f.stat()
                    out[f.relative_to(self.data).as_posix()] = (st.st_size, st.st_mtime_ns)
        return out

    def push(self) -> None:
        """Upload changed files and delete removed ones. Raises SyncError if anything failed."""
        if not self.enabled:
            return
        with self.lock:
            now = self.scan()
            changed = [r for r, sig in now.items() if self.known.get(r) != sig]
            removed = [r for r in self.known if r not in now]
            for rel in changed:
                ctype = mimetypes.guess_type(rel)[0] or "application/octet-stream"
                self._req("POST", f"object/{self.bucket}/{self._q(rel)}", (self.data / rel).read_bytes(), ctype, {"x-upsert": "true"})
                self.known[rel] = now[rel]
            for i in range(0, len(removed), 500):
                batch = removed[i:i + 500]
                self._json("DELETE", f"object/{self.bucket}", {"prefixes": batch})
                for rel in batch:
                    self.known.pop(rel, None)

    def push_or_retry(self) -> None:
        for wait in (0, 1, 2):
            time.sleep(wait)
            try:
                self.push()
                return
            except SyncError as e:
                err = e
        print(f"  SYNC FAILED, retrying in the background: {err}")
        if not getattr(self, "_retrying", False):
            self._retrying = True
            threading.Thread(target=self._retry_loop, daemon=True).start()

    def _retry_loop(self) -> None:
        while True:
            time.sleep(30)
            try:
                self.push()
                print("  SYNC recovered.")
                self._retrying = False
                return
            except SyncError as e:
                print(f"  SYNC still failing: {e}")
