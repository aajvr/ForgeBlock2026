"""v8.25: build the FIXED background set of the static per-client check.

The per-client check (backend/app/ml/client_classifier.py) compares a client's
references with "other people captured the same way". Until v8.24 those were
all other live clients; now it is a fixed set of participants of the team's own
static dataset, chosen by a rule so the set is repeatable (Chapter 3):

  1. only participants the static model v8.16 was TRAINED on (never its 11
     test participants 1, 3, 11, 15, 16, 20, 24, 25, 29, 42, 47, so the
     Chapter 5 test results stay independent; never its 8 validation people);
  2. never anyone enrolled in ForgeBlock as a client (--exclude), so nobody is
     ever compared against themself;
  3. at least 10 usable genuine signatures;
  4. 12 people drawn with a fixed seed (7); references = genuine signatures 1-10.

Only the embeddings are written (no images). Load the output into the database
once with  `cd backend && python -m app.import_static_background <file.json>`.

    python training/build_static_background.py --data <static dataset, CEDAR layout> \
        --exclude 1-10,12,16,19,23,28,31,43,46 --out static_background.json
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.ml.capture import standardize  # noqa: E402
from app.ml.engine import _file_fingerprint  # noqa: E402
from app.ml.preprocessing import decode_image, preprocess_signature  # noqa: E402
from app.ml.static_model import load_static_model  # noqa: E402

V816_TEST = [1, 3, 11, 15, 16, 20, 24, 25, 29, 42, 47]
V816_VAL = [12, 22, 23, 30, 32, 36, 37, 48]
PEOPLE, REFS, SEED = 12, 10, 7


def numbers(spec: str) -> set[int]:
    out = set()
    for part in filter(None, spec.split(",")):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="own static dataset (full_org/original_<n>_<i>.png)")
    ap.add_argument("--exclude", default="", help="participants enrolled as clients, e.g. 1-10,12,16")
    ap.add_argument("--weights", default=str(ROOT / "backend" / "weights"))
    ap.add_argument("--out", default="static_background.json")
    args = ap.parse_args()
    data, weights = Path(args.data), Path(args.weights)
    have = {}
    for p in (data / "full_org").glob("original_*_*.png"):
        n = int(p.stem.split("_")[1])
        have.setdefault(n, []).append(p)
    excluded = numbers(args.exclude) | set(V816_TEST) | set(V816_VAL)
    eligible = sorted(n for n, files in have.items() if n not in excluded and len(files) >= REFS)
    if len(eligible) < PEOPLE:
        print(f"Only {len(eligible)} eligible participants; need {PEOPLE}.")
        return 1
    chosen = sorted(np.random.default_rng(SEED).choice(eligible, PEOPLE, replace=False).tolist())
    model = load_static_model(weights)
    people = []
    for n in chosen:
        imgs = [standardize(decode_image((data / "full_org" / f"original_{n}_{i}.png").read_bytes()))
                for i in range(1, REFS + 1)]
        emb = model.embed_batch(np.stack([preprocess_signature(im) for im in imgs]))
        people.append({"code": f"P{n:02d}", "embeddings": np.round(emb, 6).tolist()})
    out = {
        "fingerprint": _file_fingerprint(weights / "static_model.keras"),
        "built": date.today().isoformat(),
        "rule": f"v8.16 training participants, minus clients ({args.exclude or 'none'}); {PEOPLE} drawn with "
                f"seed {SEED} from {len(eligible)} eligible; genuine 1-{REFS}",
        "eligible": [f"P{n:02d}" for n in eligible],
        "people": people,
    }
    Path(args.out).write_text(json.dumps(out))
    print(f"{len(people)} people ({', '.join(p['code'] for p in people)}) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
