"""Per-client classifier for static screening (v8.10).

The plain method compares the questioned signature with the client's
references by distance only. This step also asks: is it closer to THIS
client than to other people captured the same way? For each screening a
small kernel classifier (least-squares SVM, RBF kernel; Suykens and
Vandewalle's LS-SVM, solved in closed form with NumPy) is fitted on

    positives  = the client's own static reference embeddings
    negatives  = the static reference embeddings of OTHER clients in this
                 ForgeBlock database (the "background"), up to 10 each

The static model itself is not changed or retrained; only its embeddings
are used, and nobody's signature image is shown or shared.

Results (v8.12 MobileNetV3 static model, ForgeBlock's own 55-participant
static data, 5-fold person-disjoint, 10 references): skilled-forgery EER
23.8% with distance only -> 16.4% with this check (AUC 0.849 -> 0.914).
The background must be captured like the clients: CEDAR signatures as
background made own-data results worse (EER 30%, earlier SigNet test). So
the classifier is used only when at least MIN_BACKGROUND_CLIENTS other
clients have at least the minimum number of static references; otherwise
the plain distance method is used as before.

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

MIN_BACKGROUND_CLIENTS = 10
MAX_BACKGROUND_CLIENTS = 60
REFS_PER_BACKGROUND_CLIENT = 10
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
