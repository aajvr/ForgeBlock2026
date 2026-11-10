"""Dynamic signatures with limited pen data (v8.11).

A dynamic signature can lack pen tilt and/or pressure: drawn with a finger,
a mouse, a stylus that is not an Apple Pencil, or a pen without tilt. Such
signatures are accepted and labelled "Limited pen data". Two signatures are
always compared on the pen data BOTH of them have (a "comparison mode"):

    full         x, y, time, pen state, tilt and pressure
    no_tilt      tilt left out
    no_pressure  pressure left out
    basic        tilt and pressure left out

Every dynamic reference stores its embedding in each mode it can take part
in (features["_pen"]), so a screening never needs the reference strokes,
which stay on the computer that enrolled them.

Mode of a screening: the questioned signature's own mode when at least
MIN_SAME_MODE references (or all of them) have that pen data too; otherwise
the mode that leaves out everything the questioned signature or any
reference lacks, so every reference is used.
"""
import numpy as np

from ..config import MIN_ADAPTIVE_SAMPLES
from ..ml.dynamic_model import missing_from_key, mode_key
from ..ml.engine import get_engine
from ..models import SignatureProfile
from ..services import load_strokes

LIMITED = "limited"
LIMITED_LABEL = "Limited pen data"
MIN_SAME_MODE = MIN_ADAPTIVE_SAMPLES
CHANNEL_WORDS = {"tilt": "pen tilt", "pressure": "pen pressure"}


def words(missing) -> str:
    """{"tilt", "pressure"} -> "pen pressure or tilt"."""
    m = sorted(missing)
    if len(m) == 2:
        return "pen pressure or tilt"
    return CHANNEL_WORDS[m[0]] if m else ""


def enroll_payload(pts) -> dict:
    """Fields for a new dynamic SignatureProfile from its points: embedding
    (its own mode), capture_device and the features["_pen"] entry."""
    engine = get_engine()
    missing, modes = engine.dynamic_mode_embeddings(pts)
    native = mode_key(missing)
    return {
        "embedding": modes.get(native) or engine.dynamic_embedding(pts).tolist(),
        "capture_device": LIMITED if missing else None,
        "pen": {"missing": sorted(missing), "modes": modes},
    }


def enroll_notice(missing) -> str | None:
    if not missing:
        return None
    return (f"This signature has no {words(missing)} (finger, mouse or a pen without these sensors). "
            f"It was saved and labelled \"{LIMITED_LABEL}\"; screenings that use it compare shape and timing "
            f"without the {words(missing)}.")


def ref_missing(p: SignatureProfile) -> frozenset:
    pen = (p.features or {}).get("_pen")
    if pen is not None:
        return frozenset(pen.get("missing") or ())
    # References from before v8.11: "development" = pen without tilt.
    return frozenset({"tilt"}) if p.capture_device == "development" else frozenset()


def ref_embedding(p: SignatureProfile, mode: str) -> np.ndarray | None:
    """The reference's embedding in a comparison mode: stored, or computed
    from its strokes when they are on this computer (older references)."""
    pen = (p.features or {}).get("_pen") or {}
    if mode in (pen.get("modes") or {}):
        return np.array(pen["modes"][mode])
    if not pen and mode == mode_key(ref_missing(p)):
        return np.array(p.embedding)
    strokes = load_strokes(p.sample_path)
    if strokes is None:
        return None
    from ..ml.dynamic_features import points_from_payload

    return get_engine().dynamic_mode_embedding(points_from_payload(strokes), mode)


def choose_mode(test_missing: frozenset, profiles: list[SignatureProfile]) -> tuple[str, list[SignatureProfile]]:
    same = [p for p in profiles if ref_missing(p) <= test_missing]
    if same and (len(same) >= MIN_SAME_MODE or len(same) == len(profiles)):
        return mode_key(test_missing), same
    union = set(test_missing)
    for p in profiles:
        union |= ref_missing(p)
    return mode_key(union), profiles


def compare_set(pts, profiles: list[SignatureProfile]):
    """(test embedding, [(profile, ref embedding)], mode, test_missing, cfg)."""
    engine = get_engine()
    test_missing = engine.dynamic_missing(pts)
    mode, chosen = choose_mode(test_missing, profiles)
    pairs = []
    for p in chosen:
        e = ref_embedding(p, mode)
        if e is not None:
            pairs.append((p, e))
    test = engine.dynamic_mode_embedding(pts, mode)
    return test, pairs, mode, test_missing, engine.dynamic_cfg_for(mode)


def screening_note(mode: str, test_missing, pairs) -> dict | None:
    """What the result page says about the pen data (None for a full comparison)."""
    left_out = missing_from_key(mode)
    if not left_out:
        return None
    refs_missing = set()
    for p, _ in pairs:
        refs_missing |= ref_missing(p)
    parts = []
    if test_missing:
        parts.append(f"The questioned signature has no {words(test_missing)}.")
    if refs_missing - set(test_missing):
        parts.append(f"Some saved references have no {words(refs_missing - set(test_missing))}.")
    engine = get_engine()
    how = ("a model trained without pen pressure and tilt" if engine._uses_basic(mode)
           else f"shape and timing without the {words(left_out)}")
    parts.append(f"The comparison used {how}, so this result is less certain than an Apple Pencil screening.")
    return {
        "label": LIMITED_LABEL,
        "mode": mode,
        "left_out": sorted(left_out),
        "questioned_missing": sorted(test_missing),
        "references_missing": sorted(refs_missing),
        "message": " ".join(parts),
    }


def public_features(features: dict | None) -> dict:
    """Profile features without the stored embeddings."""
    return {k: v for k, v in (features or {}).items() if not k.startswith("_")}
