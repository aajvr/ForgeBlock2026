"""Per-client classifier for static screening (v8.10).

The plain method compares the questioned signature with the client's
references by distance only. This step also asks: is it closer to THIS
client than to other people captured the same way? For each screening a
small kernel classifier (least-squares SVM, RBF kernel; Suykens and
Vandewalle's LS-SVM, solved in closed form with NumPy) is fitted on

    positives  = the client's own static reference embeddings
    negatives  = a FIXED background set (v8.25): 10 reference embeddings each
                 of 12 participants of the team's own static dataset, stored
                 once as the "static_background" setting (see below)

The static model itself is not changed or retrained; only its embeddings
are used, and nobody's signature image is shown or shared.

Results (v8.12 MobileNetV3 static model, ForgeBlock's own 55-participant
static data, 5-fold person-disjoint, 10 references): skilled-forgery EER
23.8% with distance only -> 16.4% with this check (AUC 0.849 -> 0.914).
The background must be captured like the clients: CEDAR signatures as
background made own-data results worse (EER 30%, earlier SigNet test).

v8.25 fixed background. Until v8.24 the background was every other active
client in the database. That made results drift as clients were added
(2026-11-16: 12 -> 28 other clients) and, worse, a person enrolled twice
(two client records with the same signer) became "another person who signs
like this", which pushed that person's genuine signatures to Inconsistent.
The background is now a fixed set built by training/build_static_background.py
from the own static dataset with a fixed rule (v8.16 training participants
only, never its test participants; never anyone enrolled as a client; 12
people chosen with seed 7; references 1-10). Live clients are never used.
On the 10 held-out own participants it gives the same numbers as the set-up
the calibration was fitted with (genuine C/?/X 55/29/16 %, skilled 5/12/83 %,
EER 16.0 % vs 55/31/14, 4.5/13/82.5, 16.5 %); 20 references per person
gave no gain. Without a background for the loaded model the plain distance
method is used.

Score normalisation: the raw LS-SVM output depends on how many background
clients there are, so it is rescaled with the classifier's own
leave-one-out predictions (closed form for LS-SVM, Cawley and Talbot):

    s = (f(x) - mean LOO(negatives)) / (mean LOO(positives) - mean LOO(negatives))

0 = like a typical other person, 1 = like the client's typical genuine
signature. s is turned into P(genuine) with Platt calibration (a, b in
weights/calibration.json, "static_client_classifier", keyed by the static
model fingerprint like the v8.5 calibration).
"""
from __future__ import annotations

import numpy as np

MIN_BACKGROUND_CLIENTS = 10       # people in the background set, at least
REFS_PER_BACKGROUND_CLIENT = 10
BACKGROUND_SETTING = "static_background"  # Setting key holding the fixed set (v8.25)
GAMMA_SCALE = 2.0   # RBF width: gamma = GAMMA_SCALE / (dim * variance of the training set)
LAMBDA = 10.0       # LS-SVM regularisation


def _sq(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.maximum((a * a).sum(1)[:, None] + (b * b).sum(1)[None] - 2 * a @ b.T, 0)


def fit(positives: np.ndarray, negatives: np.ndarray, gamma_scale: float = GAMMA_SCALE,
        lam: float = LAMBDA):
    """Returns score(Q) -> normalised score per row of Q (see module docstring)."""
    pos = np.asarray(positives, np.float64)
    neg = np.asarray(negatives, np.float64)
    x = np.r_[pos, neg]
    y = np.r_[np.ones(len(pos)), -np.ones(len(neg))]
    w = np.r_[np.full(len(pos), len(neg) / len(pos)), np.ones(len(neg))]  # balance the classes
    g = gamma_scale / (x.shape[1] * max(float(x.var()), 1e-12))
    k = np.exp(-g * _sq(x, x))
    n = len(x)
    a = np.zeros((n + 1, n + 1))
    a[0, 1:] = 1
    a[1:, 0] = 1
    a[1:, 1:] = k + np.diag(1 / (lam * w))
    ai = np.linalg.inv(a)
    sol = ai @ np.r_[0.0, y]
    b, alpha = sol[0], sol[1:]
    loo = y - alpha / np.diag(ai)[1:]
    mp, mn = loo[: len(pos)].mean(), loo[len(pos):].mean()
    span = max(mp - mn, 1e-3)

    def score(q: np.ndarray) -> np.ndarray:
        q = np.atleast_2d(np.asarray(q, np.float64))
        return (np.exp(-g * _sq(q, x)) @ alpha + b - mn) / span

    return score


def probability(s: float, calibration: dict) -> float:
    t = float(calibration["a"]) * float(np.clip(s, -10, 10)) + float(calibration["b"])
    return float(1 / (1 + np.exp(-t)))


_cache: dict = {}


def background_from_setting(value: dict | None, fingerprint: str | None, dim: int) -> tuple[np.ndarray | None, dict]:
    """The fixed background (v8.25) as an (n, dim) array, or None with the reason.

    `value` is the stored setting: {"fingerprint": ..., "people": [{"code": "P14",
    "embeddings": [[...], ...]}, ...], ...}. It is used only for the static model
    it was built with (same fingerprint and embedding size), with at least
    MIN_BACKGROUND_CLIENTS people of REFS_PER_BACKGROUND_CLIENT references."""
    info = {"source": "fixed", "background_clients": 0, "min_background_clients": MIN_BACKGROUND_CLIENTS}
    if not value or not value.get("people"):
        return None, {**info, "reason": "no background set stored"}
    if value.get("fingerprint") != fingerprint:
        return None, {**info, "reason": "background set was built for another static model"}
    first = value["people"][0].get("embeddings") or [[]]
    key = (fingerprint, dim, value.get("built"), tuple(p.get("code") for p in value["people"]),
           tuple(first[0][:4]), tuple(len(p.get("embeddings") or []) for p in value["people"]))
    if key not in _cache:
        rows = []
        for person in value["people"]:
            e = [v for v in person.get("embeddings", [])[:REFS_PER_BACKGROUND_CLIENT] if len(v) == dim]
            if len(e) == REFS_PER_BACKGROUND_CLIENT:
                rows.append(np.asarray(e, np.float64))
        _cache.clear()
        _cache[key] = (np.concatenate(rows) if rows else None, len(rows))
    arr, people = _cache[key]
    info["background_clients"] = people
    if arr is None or people < MIN_BACKGROUND_CLIENTS:
        return None, {**info, "reason": "background set too small"}
    return arr, info
