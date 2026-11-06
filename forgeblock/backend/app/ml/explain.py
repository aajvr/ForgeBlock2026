"""Visual explanations for static screenings.

heatmap  - occlusion sensitivity (explainable AI): small patches of the
           questioned signature are covered one at a time and the mean cosine
           similarity to the client's references is recomputed. Where covering
           a patch RAISES the similarity, that part of the signature looked
           unlike the references (shown red). Where covering it LOWERS the
           similarity, that part matched the references (shown blue).
overlay  - the questioned signature laid over its best-matching reference,
           both as the model sees them (red = only in the questioned
           signature, blue = only in the reference, dark = shared).
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


def overlay_png(test_img: np.ndarray, ref_img: np.ndarray) -> bytes:
    t = _model_view(test_img) < 128
    r = _model_view(ref_img) < 128
    out = np.full((IMAGE_SIZE, IMAGE_SIZE, 3), 255, np.uint8)
    out[r & ~t] = (230, 140, 40)    # blue (BGR): only in the reference
    out[t & ~r] = (50, 50, 220)     # red: only in the questioned signature
    out[t & r] = (60, 40, 30)       # dark: shared
    out = cv2.resize(out, (IMAGE_SIZE * 2, IMAGE_SIZE * 2), interpolation=cv2.INTER_NEAREST)
    ok, png = cv2.imencode(".png", out)
    return png.tobytes()
