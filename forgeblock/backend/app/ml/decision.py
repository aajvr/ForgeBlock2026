"""Similarity metrics, thresholds, decision rules and confidence scores.

Static (Section 3.3.4): cosine similarity, Euclidean and Manhattan distance,
each voted against its threshold, majority rule (>= 2 of 3), eq. (1)-(6).

Dynamic (Section 3.3.5): mean cosine similarity and mean Euclidean distance
over the enrolled references, genuine only if both pass, personal threshold
tau_p = clip(m - 1.5 * s, tau_min, tau_max), tau_E = sqrt(2 (1 - tau_c)).

Confidence score (v8.2): writer-dependent z-score, after target-dependent
score normalization (Fierrez-Aguilar et al., 2005; Jain, Nandakumar & Ross,
2005). For each metric, the distance of the questioned value from the
threshold is measured in units of the client's OWN natural variation, sd,
the standard deviation of their reference-vs-reference comparisons:

    z = (value - t) / sd        (similarities, cosine)
    z = (t - value) / sd        (distances, Euclidean and Manhattan)

taken on the side of the decision (a metric on the other side gives 0), and
turned into 0-1 with the normal curve, 2 * Phi(z) - 1: on the threshold 0,
1 sd past it 68%, 2 sd 95%, 2.6 sd or more 99%. The metrics are averaged and
x 100, capped at 99 because a screening is never certain. With fewer than 2
references (no spread) sd is a third of the distance from the threshold to
a perfect match. When the threshold is further from the client's typical
value than 1.5 sd (default or clipped thresholds), sd is taken as that
distance / 1.5, matching how personal thresholds are set, so a signature as
close as the client's typical one scores about 87%. sd is never taken below
5% of the distance to a perfect match. The decision
itself (which side of the threshold) is unchanged.

Calibrated confidence (v8.5): when the module has a calibration for the
loaded model (weights/calibration.json, see engine.py), the same z-score is
turned into the PROBABILITY that the signature is genuine by logistic
(Platt) calibration fitted on held-out writers (Platt, 1999):

    P(genuine) = 1 / (1 + exp(-(a * z + b)))

with z the mean of the per-metric z-scores (static) or the cosine z-score
(dynamic), not clipped to the decision side. The binary decision is then
P(genuine) >= 0.5 and the confidence is the probability of the stated
result, max(P, 1 - P) x 100 (capped at 99). The screening result uses a
middle band of P (screening.py): Inconclusive when the probability is
close to 50/50 (Chow's reject option, 1970). Without a calibration the
v8.2 behaviour above is kept.
"""
from dataclasses import dataclass, field
from itertools import combinations
from math import erf, sqrt

import numpy as np

ADAPTIVE_K = 1.5
CONFIDENCE_CAP = 99.0


@dataclass
class Decision:
    classification: str
    confidence: float
    similarity: float  # mean cosine similarity, reported as the similarity score
    metrics: dict
    thresholds: dict
    threshold_source: str
    votes: dict = field(default_factory=dict)
    p_genuine: float | None = None  # calibrated probability (v8.5), None if uncalibrated
    band: tuple | None = None       # (lo, hi) Inconclusive band of this module's calibration

    def as_dict(self) -> dict:
        return {
            "classification": self.classification,
            "confidence": round(self.confidence, 2),
            "similarity": round(self.similarity, 4),
            "metrics": {k: round(v, 4) for k, v in self.metrics.items()},
            "thresholds": {k: round(v, 4) for k, v in self.thresholds.items()},
            "threshold_source": self.threshold_source,
            "votes": self.votes,
            "p_genuine": None if self.p_genuine is None else round(self.p_genuine, 4),
        }


def pair_metrics(a: np.ndarray, b: np.ndarray) -> dict:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    return {
        "cosine": float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12)),
        "euclidean": float(np.linalg.norm(a - b, ord=2)),
        "manhattan": float(np.linalg.norm(a - b, ord=1)),
    }


def mean_metrics(test: np.ndarray, refs: list[np.ndarray]) -> dict:
    per_ref = [pair_metrics(test, r) for r in refs]
    return {k: float(np.mean([m[k] for m in per_ref])) for k in per_ref[0]}


EXACT_MATCH_COSINE = 0.99999


def exact_match_index(test: np.ndarray, refs: list[np.ndarray]) -> int | None:
    """Index of a reference that is the same sample as the questioned one
    (identical embedding), or None."""
    for i, r in enumerate(refs):
        if pair_metrics(test, r)["cosine"] >= EXACT_MATCH_COSINE:
            return i
    return None


def typical_genuine(refs: list[np.ndarray]) -> dict | None:
    """The client's genuine-vs-genuine (mean, sd) per metric over all reference
    pairs, used to scale the confidence score."""
    if len(refs) < 2:
        return None
    return _intra_user_stats(refs)


def _z_margin(value: float, t: float, stats: tuple | None, higher_is_genuine: bool) -> float:
    """Signed distance past the threshold toward the genuine side, in units of
    the client's own spread (sd of their reference-vs-reference values)."""
    gain = (value - t) if higher_is_genuine else (t - value)
    to_perfect = (1 - t) if higher_is_genuine else t  # threshold to a perfect match
    floor = 0.05 * to_perfect
    if stats is None:
        sd = to_perfect / 3
    else:
        mean, sd = stats
        # When the threshold sits further from the client's typical value than
        # their personal threshold would (default or clipped thresholds), use
        # that distance / ADAPTIVE_K as the scale, as the personal threshold
        # t = mean - ADAPTIVE_K * sd does. So a signature as close as the
        # client's typical one always lands near 87%, never at the cap.
        to_typical = (mean - t) if higher_is_genuine else (t - mean)
        sd = max(sd, to_typical / ADAPTIVE_K)
    return gain / (max(sd, floor) + 1e-12)


def _phi(z: float) -> float:
    return 0.5 * (1 + erf(z / sqrt(2)))


def _confidence(margins: list[float], genuine: bool) -> float:
    side = [m if genuine else -m for m in margins]
    score = np.mean([max(0.0, 2 * _phi(z) - 1) for z in side]) * 100
    return float(np.clip(score, 0, CONFIDENCE_CAP))


def calibrated_probability(z: float, calibration: dict) -> float:
    """Platt calibration: P(genuine) = 1 / (1 + exp(-(a z + b)))."""
    from math import exp

    t = float(calibration["a"]) * float(np.clip(z, -15, 15)) + float(calibration["b"])
    return 1.0 / (1.0 + exp(-t))


def _band(calibration: dict | None) -> tuple | None:
    b = (calibration or {}).get("band")
    if b and len(b) == 2 and 0 <= float(b[0]) <= 0.5 <= float(b[1]) <= 1:
        return float(b[0]), float(b[1])
    return None


def _calibrated(margins: list[float], calibration: dict) -> tuple[bool, float, float]:
    """(genuine, confidence 0-99, P(genuine)) from the signed z margins."""
    p = calibrated_probability(float(np.mean(margins)), calibration)
    genuine = p >= 0.5
    confidence = float(min(CONFIDENCE_CAP, 100 * (p if genuine else 1 - p)))
    return genuine, confidence, p


def _intra_user_stats(refs: list[np.ndarray]) -> dict:
    pairs = [pair_metrics(a, b) for a, b in combinations(refs, 2)]
    return {
        k: (float(np.mean([p[k] for p in pairs])), float(np.std([p[k] for p in pairs])))
        for k in pairs[0]
    }


# ---------------------------------------------------------------- static ---

def static_adaptive_thresholds(refs: list[np.ndarray], cfg: dict) -> dict:
    stats = _intra_user_stats(refs)
    b = cfg["bounds"]
    m, s = stats["cosine"]
    cos_t = float(np.clip(m - ADAPTIVE_K * s, *b["cosine"]))
    m, s = stats["euclidean"]
    euc_t = float(np.clip(m + ADAPTIVE_K * s, *b["euclidean"]))
    m, s = stats["manhattan"]
    man_t = float(np.clip(m + ADAPTIVE_K * s, *b["manhattan"]))
    return {"cosine": cos_t, "euclidean": euc_t, "manhattan": man_t}


def static_decision(metrics: dict, thresholds: dict, source: str, typical: dict | None = None,
                    calibration: dict | None = None) -> Decision:
    tc, te, tm = thresholds["cosine"], thresholds["euclidean"], thresholds["manhattan"]
    votes = {
        "cosine": metrics["cosine"] >= tc,
        "euclidean": metrics["euclidean"] <= te,
        "manhattan": metrics["manhattan"] <= tm,
    }
    genuine = sum(votes.values()) >= 2

    typ = typical or {}
    margins = [
        _z_margin(metrics["cosine"], tc, typ.get("cosine"), True),
        _z_margin(metrics["euclidean"], te, typ.get("euclidean"), False),
        _z_margin(metrics["manhattan"], tm, typ.get("manhattan"), False),
    ]
    p = None
    if calibration:
        genuine, confidence, p = _calibrated(margins, calibration)
    else:
        confidence = _confidence(margins, genuine)
    return Decision(
        classification="genuine" if genuine else "forged",
        confidence=confidence,
        similarity=metrics["cosine"],
        metrics=metrics,
        thresholds=thresholds,
        threshold_source=source,
        votes=votes,
        p_genuine=p,
        band=_band(calibration),
    )


# --------------------------------------------------------------- dynamic ---

def dynamic_personal_threshold(refs: list[np.ndarray], cfg: dict) -> float:
    m, s = _intra_user_stats(refs)["cosine"]
    return float(np.clip(m - ADAPTIVE_K * s, *cfg["bounds"]["cosine"]))


def dynamic_decision(metrics: dict, tau_c: float, source: str, typical: dict | None = None,
                     calibration: dict | None = None) -> Decision:
    tau_e = float(np.sqrt(2 * (1 - tau_c)))
    votes = {
        "cosine": metrics["cosine"] >= tau_c,
        "euclidean": metrics["euclidean"] <= tau_e,
    }
    genuine = all(votes.values())
    sigma = metrics["cosine"]
    margin = _z_margin(sigma, tau_c, (typical or {}).get("cosine"), True)
    p = None
    if calibration:
        genuine, confidence, p = _calibrated([margin], calibration)
    else:
        confidence = _confidence([margin], genuine)
    return Decision(
        classification="genuine" if genuine else "forged",
        confidence=confidence,
        similarity=sigma,
        metrics=metrics,
        thresholds={"cosine": tau_c, "euclidean": tau_e},
        threshold_source=source,
        votes=votes,
        p_genuine=p,
        band=_band(calibration),
    )


# ------------------------------------------------------------ screening ---

def with_probability(d: Decision, p: float, calibration: dict) -> Decision:
    """The same decision with its result and confidence taken from another
    calibrated P(genuine) (v8.10 per-client classifier). Metrics, thresholds
    and votes stay as computed, for the details view."""
    genuine = p >= 0.5
    d.classification = "genuine" if genuine else "forged"
    d.confidence = float(min(CONFIDENCE_CAP, 100 * (p if genuine else 1 - p)))
    d.p_genuine = p
    d.band = _band(calibration) or d.band
    return d


def screen_static_embedding(test: np.ndarray, refs: list[np.ndarray], cfg: dict, min_adaptive: int) -> Decision:
    """Static decision as the application makes it (also used by the
    evaluation script, so its numbers match the system)."""
    metrics = mean_metrics(test, refs)
    if len(refs) >= min_adaptive:
        thresholds, source = static_adaptive_thresholds(refs, cfg), "adaptive"
    else:
        thresholds, source = cfg["thresholds"], "default"
    return static_decision(metrics, thresholds, source, typical_genuine(refs), cfg.get("calibration"))


def screen_dynamic_embedding(test: np.ndarray, refs: list[np.ndarray], cfg: dict, min_adaptive: int) -> Decision:
    metrics = mean_metrics(test, refs)
    if len(refs) >= min_adaptive:
        tau_c, source = dynamic_personal_threshold(refs, cfg), "adaptive"
    else:
        tau_c, source = cfg["thresholds"]["cosine"], "default"
    return dynamic_decision(metrics, tau_c, source, typical_genuine(refs), cfg.get("calibration"))


def error_reject_table(confidences: list[float], correct: list[bool], bands=range(0, 51, 5)) -> list[dict]:
    """For each Inconclusive band: how many results would be Inconclusive and
    the error rate among the rest (Chow's error-reject trade-off). Used to
    set INCONCLUSIVE_BELOW from evaluation data."""
    c = np.asarray(confidences, dtype=float)
    ok = np.asarray(correct, dtype=bool)
    rows = []
    for b in bands:
        keep = c >= b
        n = int(keep.sum())
        rows.append({
            "band": b,
            "inconclusive_rate": round(float(1 - keep.mean()) if len(c) else 0.0, 4),
            "error_rate": round(float((~ok[keep]).mean()) if n else 0.0, 4),
            "screened": n,
        })
    return rows


def suggest_band(table: list[dict], max_error: float, max_inconclusive: float = 1.0) -> dict | None:
    """The narrowest band whose remaining error is within max_error and whose
    Inconclusive share is within max_inconclusive."""
    for row in table:
        if row["error_rate"] <= max_error and row["inconclusive_rate"] <= max_inconclusive:
            return row
    return None
