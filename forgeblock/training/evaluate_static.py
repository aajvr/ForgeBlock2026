"""Evaluate (and optionally recalibrate) the static module on CEDAR.

Uses exactly the same preprocessing, model loading and decision rules as the
web application, so the numbers match what the system does.

Two protocols are reported:
  compare - pairs of signatures with the default thresholds and majority vote
            (genuine-genuine pairs vs genuine-skilled-forgery pairs)
  verify  - per writer, the first K genuine signatures are enrolled; the other
            genuine signatures and all forgeries are verified against them with
            adaptive thresholds, as in the Verify page

IMPORTANT: only evaluate on writers the model was NOT trained on, otherwise the
results are inflated. Pass those writers with --writers (e.g. 46-55).

CEDAR layout expected (as distributed):
    <cedar>/full_org/original_<writer>_<n>.png
    <cedar>/full_forg/forgeries_<writer>_<n>.png

The verify protocol also prints an error-reject table and a suggested
Inconclusive band (INCONCLUSIVE_BELOW in backend/.env) for target error rates.

Examples:
    python training/evaluate_static.py --cedar data/CEDAR --writers 46-55
    python training/evaluate_static.py --cedar data/CEDAR --calibrate-writers 36-45 --writers 46-55 --write-config
"""
import argparse
import itertools
import random
import re
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from common import ROOT, classification_metrics, eer_threshold, round_dict, save_json, seed_everything

from app.ml import decision as dec  # noqa: E402  (path set up by common)
from app.ml.engine import DEFAULT_STATIC_CONFIG, _load_config  # noqa: E402
from app.ml.preprocessing import preprocess_signature  # noqa: E402
from app.ml.static_model import load_static_model  # noqa: E402

WEIGHTS = ROOT / "backend" / "weights"
NAME_RE = re.compile(r"(original|forgeries)_(\d+)_(\d+)\.\w+$", re.I)


def parse_range(text: str | None) -> set[int] | None:
    if not text:
        return None
    out = set()
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def load_cedar(root: Path) -> dict:
    """{writer: {"genuine": [paths], "forged": [paths]}}"""
    data = defaultdict(lambda: {"genuine": [], "forged": []})
    for p in sorted(root.rglob("*")):
        m = NAME_RE.search(p.name)
        if not m:
            continue
        kind = "genuine" if m.group(1).lower() == "original" else "forged"
        data[int(m.group(2))][kind].append((int(m.group(3)), p))
    for w in data.values():
        for k in w:
            w[k] = [p for _, p in sorted(w[k])]
    if not data:
        raise SystemExit(f"No CEDAR images found under {root}")
    return dict(data)


class Embedder:
    def __init__(self):
        self.model = load_static_model(WEIGHTS)
        self.cache = {}

    def __call__(self, path: Path) -> np.ndarray:
        if path not in self.cache:
            img = cv2.imread(str(path), cv2.IMREAD_COLOR)
            self.cache[path] = self.model.embed(preprocess_signature(img))
        return self.cache[path]


def pair_scores(data, writers, embed, max_pairs_per_writer=300):
    rows = []  # (metrics, is_genuine_pair)
    for w in writers:
        g, f = data[w]["genuine"], data[w]["forged"]
        gg = list(itertools.combinations(g, 2))
        gf = list(itertools.product(g, f))
        random.shuffle(gg)
        random.shuffle(gf)
        for a, b in gg[:max_pairs_per_writer]:
            rows.append((dec.pair_metrics(embed(a), embed(b)), True))
        for a, b in gf[:max_pairs_per_writer]:
            rows.append((dec.pair_metrics(embed(a), embed(b)), False))
    return rows


def calibrate(rows) -> tuple[dict, dict]:
    y = [r[1] for r in rows]
    thresholds, eers = {}, {}
    for metric, higher in (("cosine", True), ("euclidean", False), ("manhattan", False)):
        t, e = eer_threshold([r[0][metric] for r in rows], y, higher)
        thresholds[metric], eers[metric] = t, e
    return thresholds, eers


def evaluate_compare(rows, thresholds) -> dict:
    y_true = [r[1] for r in rows]
    y_pred = [dec.static_decision(r[0], thresholds, "default").classification == "genuine" for r in rows]
    _, eers = calibrate(rows)
    return {**round_dict(classification_metrics(y_true, y_pred)), "eer_per_metric": round_dict(eers), "pairs": len(rows)}


def evaluate_verify(data, writers, embed, cfg, k_refs, max_error, max_inconclusive) -> dict:
    """Screens every remaining genuine signature and forgery of each writer
    against their first k_refs genuine signatures, exactly as the app does
    (same thresholds, same confidence score). Also builds the error-reject
    table used to set INCONCLUSIVE_BELOW (Chow, 1970)."""
    y_true, y_pred, conf = [], [], []
    for w in writers:
        g, f = data[w]["genuine"], data[w]["forged"]
        refs = [embed(p) for p in g[:k_refs]]
        for p, genuine in [(p, True) for p in g[k_refs:]] + [(p, False) for p in f]:
            d = dec.screen_static_embedding(embed(p), refs, cfg, min_adaptive=5)
            y_true.append(genuine)
            y_pred.append(d.classification == "genuine")
            conf.append(d.confidence)
    table = dec.error_reject_table(conf, [t == p for t, p in zip(y_true, y_pred)])
    return {**round_dict(classification_metrics(y_true, y_pred)), "samples": len(y_true),
            "references_per_writer": k_refs, "error_reject": table,
            "suggested_band": dec.suggest_band(table, max_error, max_inconclusive),
            "targets": {"max_error": max_error, "max_inconclusive": max_inconclusive}}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cedar", type=Path, required=True)
    ap.add_argument("--writers", help="Test writers, e.g. 46-55 (default: all)")
    ap.add_argument("--calibrate-writers", help="Writers used to recalibrate default thresholds (EER)")
    ap.add_argument("--write-config", action="store_true", help="Save recalibrated thresholds + results to static_config.json")
    ap.add_argument("--refs", type=int, default=5, help="Enrolled references per writer in the verify protocol")
    ap.add_argument("--max-error", type=float, default=0.05, help="Target error among non-Inconclusive results")
    ap.add_argument("--max-inconclusive", type=float, default=0.25, help="Largest share that may go to the examiner")
    ap.add_argument("--out", type=Path, default=ROOT / "training" / "results" / "static_evaluation.json")
    args = ap.parse_args()

    seed_everything(42)
    data = load_cedar(args.cedar)
    test_writers = sorted(parse_range(args.writers) or data.keys())
    test_writers = [w for w in test_writers if w in data]
    embed = Embedder()
    cfg = _load_config(WEIGHTS / "static_config.json", DEFAULT_STATIC_CONFIG)
    print(f"Model: {embed.model.kind} ({embed.model.source}); test writers: {test_writers}")
    t0 = time.time()

    result = {"model": embed.model.source, "test_writers": test_writers}
    if args.calibrate_writers:
        cal = [w for w in sorted(parse_range(args.calibrate_writers)) if w in data]
        overlap = set(cal) & set(test_writers)
        if overlap:
            raise SystemExit(f"Calibration and test writers overlap: {sorted(overlap)}")
        thresholds, eers = calibrate(pair_scores(data, cal, embed))
        cfg["thresholds"] = thresholds
        result["calibration"] = {"writers": cal, "thresholds": thresholds, "eer": eers}
        print("Recalibrated thresholds:", round_dict(thresholds, 6))

    result["thresholds_used"] = cfg["thresholds"]
    result["compare"] = evaluate_compare(pair_scores(data, test_writers, embed), cfg["thresholds"])
    result["verify"] = evaluate_verify(data, test_writers, embed, cfg, args.refs,
                                       args.max_error, args.max_inconclusive)
    result["seconds"] = round(time.time() - t0, 1)
    save_json(args.out, result)

    for proto in ("compare", "verify"):
        r = result[proto]
        print(
            f"{proto:8s} acc {r['accuracy']:.4f}  prec {r['precision']:.4f}  rec {r['recall']:.4f}  "
            f"F1 {r['f1']:.4f}  FAR {r['far']:.4f}  FRR {r['frr']:.4f}"
        )
    print("EER per metric (compare):", result["compare"]["eer_per_metric"])
    print("\nError-reject table (verify protocol):")
    print("  band  inconclusive  error among the rest")
    for row in result["verify"]["error_reject"]:
        print(f"  {row['band']:4d}  {row['inconclusive_rate']:12.1%}  {row['error_rate']:10.1%}")
    sb = result["verify"]["suggested_band"]
    if sb:
        print(f"Suggested INCONCLUSIVE_BELOW={sb['band']} (error {sb['error_rate']:.1%}, "
              f"inconclusive {sb['inconclusive_rate']:.1%}). Put it in backend/.env.")
    else:
        print("No band meets both targets; relax --max-error or --max-inconclusive.")
    print(f"Saved {args.out}")

    if args.write_config:
        existing = _load_config(WEIGHTS / "static_config.json", DEFAULT_STATIC_CONFIG)
        existing["thresholds"] = cfg["thresholds"]
        existing["evaluation"] = {"compare": result["compare"], "verify": result["verify"], "test_writers": test_writers}
        existing.pop("model_version", None)
        save_json(WEIGHTS / "static_config.json", existing)
        print("Updated backend/weights/static_config.json")


if __name__ == "__main__":
    main()
