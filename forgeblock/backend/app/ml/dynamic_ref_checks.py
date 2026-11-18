"""Consistency checks for a client's dynamic references (enrollment hygiene).

A bad capture can pass the single-signature quality check and still spoil a
client's results: it widens the spread of the references, which lowers the
personal threshold. These checks compare each reference with the client's
OTHER references (leave-one-out) and flag the ones that look like bad
captures, so the examiner can review and remove them.

Advice only: nothing here deletes a reference or changes how a screening is
computed. Uses only what is stored on each SignatureProfile (features and
embeddings); the strokes are not needed.
"""
from collections import Counter

import numpy as np

from .dynamic_model import mode_key

# Fewest references a client needs before any reference is flagged.
MIN_REFERENCES = 4
# Flag a reference that took more than this many times the others' median duration...
DURATION_HIGH = 2.5
# ...or less than this many times.
DURATION_LOW = 0.4
# Flag a reference whose stroke count is this far or more from the others' most common count.
STROKE_DIFF = 2
# Flag a reference whose mean cosine to the others is below this...
LOOKS_DIFFERENT_COSINE = 0.80
# ...AND more than this many MADs below the median of all references' means.
LOOKS_DIFFERENT_MADS = 3.0

REASON_LONGER = "Took much longer than this client's other signatures."
REASON_SHORTER = "Took much shorter than this client's other signatures."
REASON_STROKES = "Has a different number of pen lifts than the other signatures."
REASON_LOOKS = "Looks different from this client's other signatures."


def _missing(p) -> frozenset:
    pen = (p.features or {}).get("_pen")
    if pen is not None:
        return frozenset(pen.get("missing") or ())
    # References from before v8.11: "development" = pen without tilt.
    return frozenset({"tilt"}) if p.capture_device == "development" else frozenset()


def _embedding(p, mode: str) -> np.ndarray | None:
    """The stored embedding of a reference in a comparison mode, if stored."""
    pen = (p.features or {}).get("_pen") or {}
    modes = pen.get("modes") or {}
    e = modes.get(mode)
    if e is None and mode == mode_key(_missing(p)) and p.embedding is not None:
        e = p.embedding
    if e is None:
        return None
    v = np.asarray(e, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 0 else None


def _cosine(a, b) -> float | None:
    """Cosine of two references in the mode both of them can take part in."""
    mode = mode_key(_missing(a) | _missing(b))
    ea, eb = _embedding(a, mode), _embedding(b, mode)
    if ea is None or eb is None:
        return None
    return float(ea @ eb)


def _feature(p, key: str):
    v = (p.features or {}).get(key)
    return float(v) if isinstance(v, (int, float)) else None


def flag_references(profiles) -> dict[int, list[str]]:
    """{profile_id: [reasons]} for the client's dynamic references that look
    like bad captures. Empty below MIN_REFERENCES references."""
    profiles = [p for p in profiles or [] if getattr(p, "modality", "dynamic") == "dynamic"]
    if len(profiles) < MIN_REFERENCES:
        return {}
    out: dict[int, list[str]] = {}

    def add(pid, reason):
        out.setdefault(pid, [])
        if reason not in out[pid]:
            out[pid].append(reason)

    # 5. Duration outlier.
    durations = {p.id: _feature(p, "duration") for p in profiles}
    for p in profiles:
        own = durations[p.id]
        others = [d for i, d in durations.items() if i != p.id and d]
        if not own or not others:
            continue
        ratio = own / float(np.median(others))
        if ratio > DURATION_HIGH:
            add(p.id, REASON_LONGER)
        elif ratio < DURATION_LOW:
            add(p.id, REASON_SHORTER)

    # 6. Stroke count outlier (against every most common count, when tied).
    strokes = {p.id: _feature(p, "strokes") for p in profiles}
    for p in profiles:
        own = strokes[p.id]
        others = [int(s) for i, s in strokes.items() if i != p.id and s is not None]
        if own is None or not others:
            continue
        counts = Counter(others)
        top = max(counts.values())
        modes = [k for k, n in counts.items() if n == top]
        if all(abs(own - m) >= STROKE_DIFF for m in modes):
            add(p.id, REASON_STROKES)

    # 7. Looks different: mean cosine to the others, far below everyone else's.
    means: dict[int, float] = {}
    for p in profiles:
        cos = [c for o in profiles if o.id != p.id for c in [_cosine(p, o)] if c is not None]
        if cos:
            means[p.id] = float(np.mean(cos))
    if len(means) >= MIN_REFERENCES:
        vals = np.array(list(means.values()))
        med = float(np.median(vals))
        mad = float(np.median(np.abs(vals - med)))
        for pid, m in means.items():
            if m < LOOKS_DIFFERENT_COSINE and m < med - LOOKS_DIFFERENT_MADS * mad:
                add(pid, REASON_LOOKS)

    return out


def pen_mix_notice(profiles) -> str | None:
    """Client-level notice when the references mix full pen data and
    Limited pen data. None when they all have the same kind."""
    profiles = [p for p in profiles or [] if getattr(p, "modality", "dynamic") == "dynamic"]
    limited = sum(1 for p in profiles if _missing(p))
    full = len(profiles) - limited
    if not limited or not full:
        return None
    return (f"Some references were signed with a pen that records pressure/tilt ({full}) and some without "
            f"({limited}). Screen with the same pen used for most references.")
