"""v8.26: automatic stray-mark removal for static signatures.

A small dot, dash or ink splash that is not part of the signature changes the
signature's bounding box, so the model and the handwriting features see a
different framing (a 3x2 px dot turned a genuine 73% Consistent reference into
13% Inconsistent). This module finds such marks and paints them with the paper
colour. It runs on every static reference and questioned image, but an image
with no stray mark is returned unchanged (same array), so clean images score
exactly as before and need no Re-embed.

Rules (fixed image processing, no trained model):
  1. Ink mask: background-normalised grey + Otsu; single-pixel speckle dropped.
  2. Blobs: the mask is dilated by 4% of the image's longer side so the strokes
     of one signature join; the blob with the most ink is the signature.
  3. FAR mark: a blob that lies outside the signature's box widened by 25% on
     each side and holds less than 5% of the ink.
  4. NEAR mark (needs the client's other signatures): a separate blob inside
     that zone with less than 3% of the ink, at a spot (relative to the
     signature's box) where fewer than a quarter of the client's other
     signatures have a mark. A habitual i-dot or separate stroke shows up in
     most signatures and is kept.
Bigger separate parts (a separate initial or surname) are never touched.
"""
from __future__ import annotations

import cv2
import numpy as np

DILATE = 0.04
MARGIN = 0.25
FAR_MAX_SHARE = 0.05
NEAR_MAX_SHARE = 0.03
MATCH_DIST = 0.20
MIN_SUPPORT = 0.25
MIN_OTHERS = 3  # near-mark rule needs at least this many other signatures


def _gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def ink_mask(gray: np.ndarray) -> np.ndarray:
    k = max(15, (min(gray.shape) // 8) | 1)
    bg = cv2.medianBlur(gray, k).astype(np.float32) + 1
    norm = np.clip(gray.astype(np.float32) / bg * 255, 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    m = (norm < min(t, 200)).astype(np.uint8) * 255
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    small = np.where(st[:, cv2.CC_STAT_AREA] < 3)[0]
    m[np.isin(lab, small[small > 0])] = 0
    return m


def _analyse(img: np.ndarray) -> dict | None:
    """Blobs of one image: the signature's box, far marks and near candidates."""
    gray = _gray(img)
    mask = ink_mask(gray)
    h_, w_ = mask.shape
    k = max(5, int(DILATE * max(h_, w_))) | 1
    blob = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
    if n <= 1:
        return None
    amt = np.bincount(lab[mask > 0], minlength=n)
    amt[0] = 0
    total = int(amt.sum())
    if total == 0:
        return None
    main = int(amt.argmax())
    x, y, w, h = (int(v) for v in st[main, :4])
    ex, ey = int(MARGIN * w), int(MARGIN * h)
    far, near = [], []
    for i in range(1, n):
        if i == main or amt[i] == 0:
            continue
        cx, cy, cw, ch = (int(v) for v in st[i, :4])
        inside = cx >= x - ex and cy >= y - ey and cx + cw <= x + w + ex and cy + ch <= y + h + ey
        share = amt[i] / total
        if not inside and share < FAR_MAX_SHARE:
            far.append(i)
        elif inside and share < NEAR_MAX_SHARE:
            near.append((i, (cx + cw / 2 - x) / max(w, 1), (cy + ch / 2 - y) / max(h, 1)))
    return {"mask": mask, "lab": lab, "far": far, "near": near}


def near_positions(img: np.ndarray) -> list[list[float]]:
    """Where an image has small separate marks near its signature, relative to
    the signature's box. Stored with each reference (features["_marks"]) so a
    new image can be compared with the client's habits without reloading images."""
    a = _analyse(img)
    return [] if a is None else [[round(rx, 3), round(ry, 3)] for _, rx, ry in a["near"]]


def clean(img: np.ndarray, others: list[list[list[float]]] | None = None) -> tuple[np.ndarray, dict]:
    """Remove stray marks from one static image.

    `others` = near_positions() of the client's other signatures (optional).
    Returns (image, info). When nothing is removed the input array itself is
    returned and info["removed"] is 0."""
    info = {"removed": 0, "far": 0, "near": 0, "boxes": []}
    a = _analyse(img)
    if a is None:
        return img, info
    kill = list(a["far"])
    others = [o for o in (others or []) if o is not None]
    if len(others) >= MIN_OTHERS:
        for i, rx, ry in a["near"]:
            support = sum(any(np.hypot(rx - ox, ry - oy) < MATCH_DIST for ox, oy in o) for o in others)
            if support < MIN_SUPPORT * len(others):
                kill.append(i)
    if not kill:
        return img, info
    mask, lab = a["mask"], a["lab"]
    out = img.copy()
    paper = np.median(out[mask == 0], axis=0)
    for i in kill:
        reg = cv2.dilate(((lab == i) & (mask > 0)).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        out[reg] = paper
        ys, xs = np.nonzero(reg)
        info["boxes"].append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
    info.update(removed=len(kill), far=len(a["far"]), near=len(kill) - len(a["far"]))
    return out, info
