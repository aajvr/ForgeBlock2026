"""v8.24: copy this computer's existing signature files to Supabase Storage.

Run ONCE on EVERY computer that enrolled or screened before v8.24, so the
images each PC has only locally become visible on all PCs:

    cd backend
    python -m app.sync_storage

Files already in the bucket are skipped (nothing is overwritten). Safe to run
again. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env.
"""
import sys

from . import remote_storage
from .config import STORAGE_DIR


def main() -> int:
    if not remote_storage.enabled():
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env first.")
        return 1
    if not remote_storage.ensure_bucket():
        print("Could not reach or create the Supabase Storage bucket. Check the URL and service key.")
        return 1
    files = [p for p in STORAGE_DIR.rglob("*") if p.is_file() and not p.name.endswith(".part")]
    counts = {"uploaded": 0, "exists": 0, "failed": 0}
    for i, p in enumerate(files, 1):
        rel = p.relative_to(STORAGE_DIR).as_posix()
        counts[remote_storage.upload(rel, p, overwrite=False)] += 1
        if i % 50 == 0 or i == len(files):
            print(f"{i}/{len(files)}  uploaded {counts['uploaded']}, already there {counts['exists']}, "
                  f"failed {counts['failed']}", flush=True)
    if not files:
        print(f"No files in {STORAGE_DIR}.")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
