"""Shape check for dynamic signatures: does the questioned signature LOOK
like the client's signatures?

The dynamic model compares how the pen moves over time and gives one
similarity number, so a signature that looks entirely different can still
land in the Inconclusive band. This check compares only the drawn shape:

  1. Each signature becomes SHAPE_POINTS points spread evenly along the ink
     (pen down only), centred and scaled by its larger side, so size and
     position do not matter but the aspect ratio does.
  2. Two shapes are compared with the symmetric chamfer distance: the mean
     distance from each point to the nearest point of the other shape, both
     ways. Stroke order and direction do not matter.
  3. The questioned signature's median distance to the references is set
     against how far the client's references are from each other (each
     reference's median distance to the others, then the median of those):
     ratio = questioned / client's own. Around 1 = as alike as the client's
     own signatures; SHAPE_FAR_RATIO or more = clearly a different shape.

Used only by the dynamic module (never fused with the static module) and
only as a gate on the result (screening.dynamic_gate); it does not change
the model, embeddings, thresholds or calibration.
"""
import numpy as np

# Points per signature shape (spread evenly along the ink).
SHAPE_POINTS = 96
# Fewest references with a shape before the check is used.
SHAPE_MIN_REFS = 3
# Questioned-to-references distance this many times the client's own = clearly different.
SHAPE_FAR_RATIO = 2.0
# ...and at least this far in absolute terms (share of the signature's larger side),
# so a client whose references are almost identical is not flagged for tiny changes.
SHAPE_FAR_MIN = 0.04
# Floor on the client's own distance, for the same reason.
SHAPE_OWN_FLOOR = 0.02


def shape_points(strokes: list[list[dict]], n: int = SHAPE_POINTS) -> list[list[float]] | None:
    """n points evenly along the ink, centred and scaled by the larger side."""
    segs, lengths = [], []
    for s in strokes or []:
        if not s:
            continue
        xy = np.array([[float(p["x"]), float(p["y"])] for p in s], dtype=np.float64)
        if len(xy) == 1:
            segs.append(xy)
            lengths.append(0.0)
            continue
        d = np.hypot(*np.diff(xy, axis=0).T)
        segs.append(xy)
        lengths.append(float(d.sum()))
    if not segs:
        return None
    allp = np.vstack(segs)
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    span = float(max(hi - lo))
    if span <= 0:
        return None
    total = sum(lengths)
    out = []
    for xy, length in zip(segs, lengths):
        # Points for this stroke in proportion to its length (dots get one).
        k = max(1, int(round(n * length / total))) if total > 0 else 1
        if length <= 0 or len(xy) == 1:
            out.append(xy[:1])
            continue
        cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
        at = np.linspace(0.0, cum[-1], k)
        out.append(np.stack([np.interp(at, cum, xy[:, 0]), np.interp(at, cum, xy[:, 1])], axis=1))
    pts = np.vstack(out)
    pts = (pts - (lo + hi) / 2.0) / span
    return np.round(pts, 4).tolist()


def shape_distance(a, b) -> float:
    """Symmetric chamfer distance between two shapes (share of the larger side)."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    d = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2))
    return float((d.min(axis=1).mean() + d.min(axis=0).mean()) / 2.0)


def shape_check(test, refs: list) -> dict:
    """{"used", "distance", "own", "ratio", "far", "references"} for a
    questioned shape against the client's reference shapes."""
    refs = [r for r in refs if r]
    if test is None or len(refs) < SHAPE_MIN_REFS:
        return {"used": False, "references": len(refs)}
    dist = float(np.median([shape_distance(test, r) for r in refs]))
    own_each = []
    for i, r in enumerate(refs):
        own_each.append(float(np.median([shape_distance(r, o) for j, o in enumerate(refs) if j != i])))
    own = max(float(np.median(own_each)), SHAPE_OWN_FLOOR)
    ratio = dist / own
    return {
        "used": True,
        "distance": round(dist, 4),
        "own": round(own, 4),
        "ratio": round(ratio, 2),
        "far": bool(ratio >= SHAPE_FAR_RATIO and dist >= SHAPE_FAR_MIN),
        "references": len(refs),
    }
