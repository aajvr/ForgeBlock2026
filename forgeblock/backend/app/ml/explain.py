"""Visual explanations for static screenings.

heatmap  - occlusion sensitivity (explainable AI): small patches of the
           questioned signature are covered one at a time and the mean cosine
           similarity to the client's references is recomputed. Where covering
           a patch RAISES the similarity, that part of the signature looked
           unlike the references (shown red). Where covering it LOWERS the
           similarity, that part matched the references (shown blue).
overlay  - the questioned signature laid over its best-matching reference,
           both as the model sees them (red = only in the questioned
           signature, blue = only in the reference, dark = shared). By
           default the questioned ink is first aligned onto the reference
           (shift + uniform scale) so the comparison is easier to read.

All of this is a visual aid for the examiner. Nothing here feeds the model,
the screening result, the ledger or any stored data.
"""

import cv2
import numpy as np

from .preprocessing import IMAGE_SIZE, preprocess_signature

PATCH = 42
STRIDE = 28  # 7 x 7 = 49 covered positions
CHUNK = 16  # images per model call, keeps memory use small


def occlusion_map(engine, img: np.ndarray, ref_embeddings: list[np.ndarray]) -> tuple[np.ndarray, float]:
    """Returns (sensitivity map at 224x224, baseline similarity). Positive
    values = covering the region raised the similarity (region differs)."""
    x = preprocess_signature(img)
    refs = np.stack([np.asarray(r, dtype=np.float64) for r in ref_embeddings])
    positions = [(y, xx) for y in range(0, IMAGE_SIZE - PATCH + 1, STRIDE)
                 for xx in range(0, IMAGE_SIZE - PATCH + 1, STRIDE)]
    batch = np.repeat(x[None], len(positions) + 1, axis=0)
    for i, (y, xx) in enumerate(positions, start=1):
        batch[i, y:y + PATCH, xx:xx + PATCH, :] = 1.0  # white paper = erase the ink
    emb = np.concatenate([engine.static_embed_preprocessed(batch[i:i + CHUNK])
                          for i in range(0, len(batch), CHUNK)])
    sims = (emb @ refs.T).mean(axis=1)
    base = float(sims[0])
    acc = np.zeros((IMAGE_SIZE, IMAGE_SIZE))
    cnt = np.zeros((IMAGE_SIZE, IMAGE_SIZE))
    for (y, xx), s in zip(positions, sims[1:]):
        acc[y:y + PATCH, xx:xx + PATCH] += s - base
        cnt[y:y + PATCH, xx:xx + PATCH] += 1
    return acc / np.maximum(cnt, 1), base


def _model_view(img: np.ndarray) -> np.ndarray:
    return np.clip(preprocess_signature(img)[..., 0] * 127.5 + 127.5, 0, 255).astype(np.uint8)


def heatmap_png(engine, img: np.ndarray, ref_embeddings: list[np.ndarray]) -> tuple[bytes, dict]:
    sens, base = occlusion_map(engine, img, ref_embeddings)
    gray = _model_view(img)
    scale = float(np.abs(sens).max()) or 1.0
    norm = sens / scale  # -1..1
    out = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR).astype(np.float32)
    color = np.where(norm[..., None] > 0, np.float32([40, 40, 220]), np.float32([200, 120, 30]))  # BGR red / blue
    alpha = np.abs(norm)[..., None] * 0.65
    out = out * (1 - alpha) + color * alpha
    out = np.clip(out, 0, 255).astype(np.uint8)
    out = cv2.resize(out, (IMAGE_SIZE * 2, IMAGE_SIZE * 2), interpolation=cv2.INTER_CUBIC)
    ok, png = cv2.imencode(".png", out)

    # Which third of the signature differs most, for a one-line summary.
    pos = np.clip(sens, 0, None)
    thirds = [pos[:, :75].sum(), pos[:, 75:150].sum(), pos[:, 150:].sum()]
    where = ["beginning", "middle", "end"][int(np.argmax(thirds))] if max(thirds) > 0 else None
    info = {
        "baseline_similarity": round(base, 4),
        "max_change": round(scale, 4),
        "most_different_region": where,
    }
    return png.tobytes(), info


# ------------------------------------------------------------ alignment ---
SCALE_LIMITS = (0.8, 1.25)
MAX_SHIFT = 0.15  # of the canvas width


def _ink(img: np.ndarray) -> np.ndarray:
    """The ink as the model sees it (the same binarization as the overlay)."""
    return _model_view(img) < 128


def _warp(a: np.ndarray, scale: float, dx: float, dy: float, interp=cv2.INTER_LINEAR) -> np.ndarray:
    """Scale about the canvas centre, then shift by (dx, dy) pixels."""
    c = (a.shape[1] - 1) / 2.0
    M = np.float32([[scale, 0, (1 - scale) * c + dx], [0, scale, (1 - scale) * c + dy]])
    return cv2.warpAffine(a, M, (a.shape[1], a.shape[0]), flags=interp, borderValue=0)


def _clamp(scale: float, dx: float, dy: float, size: int) -> tuple[float, float, float]:
    lim = MAX_SHIFT * size
    return (float(np.clip(scale, *SCALE_LIMITS)), float(np.clip(dx, -lim, lim)), float(np.clip(dy, -lim, lim)))


def align_ink(test: np.ndarray, ref: np.ndarray) -> tuple[np.ndarray, dict]:
    """Registers the questioned ink onto the reference ink with a shift and a
    uniform scale. Start: centres of mass and bounding-box sizes; then a small
    coarse-to-fine search that maximizes the overlap of the (blurred) inks.
    Clamped to scale 0.8-1.25 and a shift of at most 15% of the width.
    Returns (aligned questioned ink as bool, {dx, dy, scale}) in canvas pixels."""
    identity = {"dx": 0.0, "dy": 0.0, "scale": 1.0}
    if not test.any() or not ref.any():
        return test.copy(), identity
    size = test.shape[1]
    c = (size - 1) / 2.0
    ty, tx = np.nonzero(test)
    ry, rx = np.nonzero(ref)
    tw, th = np.ptp(tx) + 1, np.ptp(ty) + 1
    rw, rh = np.ptp(rx) + 1, np.ptp(ry) + 1
    s0 = float(np.clip(0.5 * (rw / tw + rh / th), *SCALE_LIMITS))
    # Shift that puts the scaled questioned centre of mass on the reference's.
    dx0 = rx.mean() - (s0 * (tx.mean() - c) + c)
    dy0 = ry.mean() - (s0 * (ty.mean() - c) + c)

    T = cv2.GaussianBlur(test.astype(np.float32), (0, 0), 2.0)
    R = cv2.GaussianBlur(ref.astype(np.float32), (0, 0), 2.0)

    def score(s, dx, dy):
        W = _warp(T, s, dx, dy)
        return float(np.minimum(W, R).sum() / (np.maximum(W, R).sum() + 1e-9))

    best = _clamp(s0, dx0, dy0, size)
    best_score = score(*best)
    for steps in ((0.03, 4.0), (0.01, 1.0)):  # coarse, then fine
        ds, dp = steps
        s_c, x_c, y_c = best
        for k in (-3, -2, -1, 0, 1, 2, 3) if ds == 0.03 else (-2, -1, 0, 1, 2):
            for i in (-2, -1, 0, 1, 2):
                for j in (-2, -1, 0, 1, 2):
                    cand = _clamp(s_c * (1 + k * ds), x_c + i * dp, y_c + j * dp, size)
                    sc = score(*cand)
                    if sc > best_score + 1e-9:
                        best, best_score = cand, sc
    # Never worse than leaving the signature where it is.
    if score(1.0, 0.0, 0.0) >= best_score:
        best = (1.0, 0.0, 0.0)
    s, dx, dy = best
    warped = _warp(test.astype(np.uint8) * 255, s, dx, dy) > 127
    return warped, {"dx": round(dx, 1), "dy": round(dy, 1), "scale": round(s, 3)}


def _inks(test_img: np.ndarray, ref_img: np.ndarray, aligned: bool) -> tuple[np.ndarray, np.ndarray, dict]:
    t, r = _ink(test_img), _ink(ref_img)
    info = {"dx": 0.0, "dy": 0.0, "scale": 1.0}
    if aligned:
        t, info = align_ink(t, r)
    return t, r, info


def overlay_png(test_img: np.ndarray, ref_img: np.ndarray, aligned: bool = True) -> bytes:
    t, r, _ = _inks(test_img, ref_img, aligned)
    out = np.full((IMAGE_SIZE, IMAGE_SIZE, 3), 255, np.uint8)
    out[r & ~t] = (230, 140, 40)    # blue (BGR): only in the reference
    out[t & ~r] = (50, 50, 220)     # red: only in the questioned signature
    out[t & r] = (60, 40, 30)       # dark: shared
    out = cv2.resize(out, (IMAGE_SIZE * 2, IMAGE_SIZE * 2), interpolation=cv2.INTER_NEAREST)
    ok, png = cv2.imencode(".png", out)
    return png.tobytes()
