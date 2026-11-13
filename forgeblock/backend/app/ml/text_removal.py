"""Printed-text removal for the QUESTIONED static signature (v8.21).

An examiner option on the Screen page ("Remove printed text"), off by default.
Only the questioned photo of a static screening is changed; references are
never touched, so enrolled clients and the static calibration stay valid.

Model (weights/text_remover.keras, run 3, fingerprint in text_remover.json):
a small U-Net with a full-resolution detail path (Gholamian et al., ICCV 2023)
trained on synthetic printed text, stamps and form lines drawn over real
signatures. Its "classes" layer gives per pixel: background, printed text,
handwriting, overlap; its output gives "printed, safe to erase".

Final setting (FINAL_REMOVER_SETTING.md, 2026-11-12), on the RAW photo, before
the line eraser (the line eraser breaks printed words into pieces and cuts
signature strokes, so it runs last):
  1. trigger: act only if at least 10% of the ink is marked printed (>= 0.5);
  2. remove: marked ink + whole ink pieces that are >= 40% marked at 0.3,
     widened 1 px, painted with the paper itself (morphological closing with a
     kernel of max(15, min(h, w) / 12) px, so the paper texture is kept);
  3. stencil: everything farther than a few px (9 x 9) from the detected
     handwriting (handwriting + overlap >= 0.3) is painted with the paper, but
     skipped if it would lift more than 5% of the signature's own ink;
  4. line eraser (capture.standardize) with the signature strokes protected.
When the trigger does not fire the photo gets exactly today's treatment
(capture.standardize), so clean signatures are unchanged.

Tests (15 held-out people, synthetic text, v8.16): clean signatures unchanged
(fired on 0%); with printed text genuine passing 7% -> 37%, forgeries 4% -> 10%,
AUC .659 -> .732. CEDAR: fired on 0.7% of clean signatures; no separation gain
on written-out cursive names. Real photos of one client: genuine on printed
forms .552 -> .594 and .535 -> .584, four forgeries all lower.
"""
import hashlib
import json
import logging
import threading
from collections import OrderedDict

import cv2
import numpy as np

from ..config import TEXT_REMOVAL, WEIGHTS_DIR
from .capture import _ink, line_mask, standardize

log = logging.getLogger(__name__)

MODEL_FILE = "text_remover.keras"
CONFIG_FILE = "text_remover.json"
DEFAULTS = {"input_hw": [192, 384], "threshold": 0.5, "trigger_ink_share": 0.10,
            "piece_threshold": 0.3, "piece_share": 0.4, "handwriting_threshold": 0.3,
            "stencil_px": 9, "stencil_min_px": 30, "stencil_max_sig_loss": 0.05}

_lock = threading.Lock()
_state: dict = {}
# The Screen page sends the same photo up to 3 times (quality, preview, screening):
# keep the last few results so the remover runs once per photo.
_cache: OrderedDict = OrderedDict()
_CACHE_SIZE = 8


def _load():
    if "model" in _state:
        return _state["model"], _state["cfg"]
    path, cfg_path = WEIGHTS_DIR / MODEL_FILE, WEIGHTS_DIR / CONFIG_FILE
    cfg = {**DEFAULTS, **(json.loads(cfg_path.read_text()) if cfg_path.exists() else {})}
    model = None
    if TEXT_REMOVAL and path.exists():
        try:
            import keras
            base = keras.models.load_model(path, compile=False)
            model = keras.Model(base.input, [base.output, base.get_layer("classes").output])
            log.info("text removal: available (%s)", cfg.get("fingerprint", "?"))
        except Exception:   # never break screening because of the optional remover
            log.exception("text removal: could not load %s", path)
            model = None
    _state.update(model=model, cfg=cfg)
    return model, cfg


def available() -> bool:
    return _load()[0] is not None


def _ink_mask(bgr) -> np.ndarray:
    return _ink(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)) > 0


def _paper(bgr) -> np.ndarray:
    """The same paper with the ink lifted (keeps shading and texture)."""
    k = max(15, (min(bgr.shape[:2]) // 12) | 1)
    return cv2.morphologyEx(bgr, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))


def text_maps(bgr: np.ndarray, model, cfg) -> tuple[np.ndarray, np.ndarray]:
    """(P(printed, safe to erase), P(handwriting or overlap)), at the image's size."""
    h, w = cfg["input_hw"]
    H, W = bgr.shape[:2]
    paper = [float(v) for v in np.median(bgr.reshape(-1, 3), 0)]
    if W >= 2 * H:
        t = (W // 2 - H) // 2
        pads = (t, W // 2 - H - t, 0, 0)
    else:
        left = (2 * H - W) // 2
        pads = (0, 0, left, 2 * H - W - left)
    big = cv2.copyMakeBorder(bgr, *pads, cv2.BORDER_CONSTANT, value=paper)
    x = cv2.cvtColor(cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    with _lock:
        e, c = model(x[None].astype(np.float32), training=False)
    bh, bw = big.shape[:2]

    def back(a):
        a = cv2.resize(np.asarray(a, np.float32), (bw, bh), interpolation=cv2.INTER_LINEAR)
        return a[pads[0]:pads[0] + H, pads[2]:pads[2] + W]
    c = np.asarray(c)[0]
    return back(np.asarray(e)[0, ..., 0]), back(c[..., 2] + c[..., 3])


def _remove(bgr, p, cfg):
    ink = _ink_mask(bgr)
    mark = (p >= cfg["threshold"]) & ink
    n, lab = cv2.connectedComponents(ink.astype(np.uint8), connectivity=8)
    hit = np.bincount(lab[ink], weights=(p[ink] >= cfg["piece_threshold"]).astype(float), minlength=n)
    piece = hit / np.maximum(np.bincount(lab[ink], minlength=n), 1) >= cfg["piece_share"]
    piece[0] = False
    m = cv2.dilate(((mark | (piece[lab] & ink)) * 255).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    out = bgr.copy()
    out[m] = np.maximum(bgr, _paper(bgr))[m]
    return out


def _stencil(bgr, hw, cfg):
    keep = cv2.dilate((hw >= cfg["handwriting_threshold"]).astype(np.uint8),
                      np.ones((cfg["stencil_px"],) * 2, np.uint8)) > 0
    if keep.sum() < cfg["stencil_min_px"]:
        return bgr, False
    out = bgr.copy()
    out[~keep] = np.maximum(bgr, _paper(bgr))[~keep]
    sig = _ink_mask(bgr) & (hw >= cfg["handwriting_threshold"])
    lost = (sig & ~_ink_mask(out)).sum() / max(1, sig.sum())
    return (out, True) if lost <= cfg["stencil_max_sig_loss"] else (bgr, False)


def _standardize_protect(bgr, hw, cfg):
    """capture.standardize, but never erasing pixels on the signature."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lines = line_mask(gray)
    if lines.any():
        lines[cv2.dilate((hw >= cfg["handwriting_threshold"]).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0] = 0
        if lines.any():
            gray = cv2.inpaint(gray, lines, 5, cv2.INPAINT_TELEA)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def clean_questioned(raw: np.ndarray) -> tuple[np.ndarray, dict]:
    """RAW questioned photo -> (image ready for screening, info).

    Always returns a line-erased image like capture.standardize. info["removed"]
    says whether printed text was taken out."""
    key = hashlib.sha1(np.ascontiguousarray(raw).tobytes()).hexdigest() + str(raw.shape)
    with _lock:
        hit = _cache.get(key)
    if hit is not None:
        return hit[0].copy(), dict(hit[1])
    out, info = _clean(raw)
    with _lock:
        _cache[key] = (out, info)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return out.copy(), dict(info)


def _clean(raw: np.ndarray) -> tuple[np.ndarray, dict]:
    model, cfg = _load()
    if model is None:
        return standardize(raw), {"requested": True, "available": False, "removed": False}
    ink = _ink_mask(raw)
    if not ink.any():
        return standardize(raw), {"requested": True, "available": True, "removed": False, "printed_share": 0.0}
    p, hw = text_maps(raw, model, cfg)
    share = float(((p >= cfg["threshold"]) & ink).sum()) / int(ink.sum())
    info = {"requested": True, "available": True, "printed_share": round(share, 4),
            "trigger": cfg["trigger_ink_share"], "model": cfg.get("fingerprint")}
    if share < cfg["trigger_ink_share"]:
        return standardize(raw), {**info, "removed": False}
    out = _remove(raw, p, cfg)
    out, stencil = _stencil(out, hw, cfg)
    _, hw = text_maps(out, model, cfg)
    return _standardize_protect(out, hw, cfg), {**info, "removed": True, "stencil": stencil}
