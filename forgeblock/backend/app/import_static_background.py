"""v8.25: store the fixed background set of the static per-client check.

Run ONCE against the shared database (any PC with the right DATABASE_URL):

    cd backend
    python -m app.import_static_background static_background.json

The file comes from training/build_static_background.py. It holds embeddings
only (no images) and is used only while the static model it was built with is
loaded (same fingerprint). Running it again replaces the stored set.
"""
import json
import sys
from pathlib import Path

from .database import SessionLocal
from .ml.client_classifier import BACKGROUND_SETTING, MIN_BACKGROUND_CLIENTS
from .services import set_setting


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 1
    value = json.loads(Path(argv[0]).read_text())
    people = value.get("people") or []
    if len(people) < MIN_BACKGROUND_CLIENTS or not value.get("fingerprint"):
        print(f"Not a background file (needs a fingerprint and at least {MIN_BACKGROUND_CLIENTS} people).")
        return 1
    with SessionLocal() as db:
        set_setting(db, BACKGROUND_SETTING, value)
    print(f"Stored {len(people)} background people for static model {value['fingerprint']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
