"""Shared training utilities: evaluation metrics and threshold calibration.

Metrics follow Chapter 4: accuracy, precision, recall, F1-score, FAR, FRR, EER.
"Positive" means the pair was classified genuine. FAR is the share of forged
pairs accepted as genuine; FRR is the share of genuine pairs rejected.
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def classification_metrics(y_true, y_pred) -> dict:
    y_true, y_pred = np.asarray(y_true, bool), np.asarray(y_pred, bool)
    tp = int(np.sum(y_true & y_pred))
    tn = int(np.sum(~y_true & ~y_pred))
    fp = int(np.sum(~y_true & y_pred))
    fn = int(np.sum(y_true & ~y_pred))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "accuracy": (tp + tn) / max(1, len(y_true)),
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "far": fp / (fp + tn) if fp + tn else 0.0,
        "frr": fn / (fn + tp) if fn + tp else 0.0,
        "tp": tp, "tn": tn, "fp": fp, "fn": fn,
    }


def eer_threshold(scores, y_true, higher_is_genuine: bool) -> tuple[float, float]:
    """Return (threshold, EER) where FAR and FRR are closest to equal."""
    scores, y_true = np.asarray(scores, float), np.asarray(y_true, bool)
    s = scores if higher_is_genuine else -scores
    best_t, best_gap, best_eer = 0.0, 1e9, 1.0
    for t in np.unique(s):
        accept = s >= t
        far = np.mean(accept[~y_true]) if (~y_true).any() else 0.0
        frr = np.mean(~accept[y_true]) if y_true.any() else 0.0
        if abs(far - frr) < best_gap:
            best_gap, best_t, best_eer = abs(far - frr), t, (far + frr) / 2
    return (float(best_t) if higher_is_genuine else float(-best_t)), float(best_eer)


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def round_dict(d: dict, n: int = 4) -> dict:
    return {k: (round(v, n) if isinstance(v, float) else v) for k, v in d.items()}
