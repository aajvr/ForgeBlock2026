"""Printable enrollment sheet for static references, and its import.

The examiner prints the sheet for a client (short bond, 8.5 x 11 in, portrait).
The client first signs in two practice boxes (warm-up, never cropped or
enrolled), then once in each of the 10 reference boxes (2 columns x 5 rows),
and the sheet is photographed with a phone or scanned. On import the four black
corner squares are found, the photo is straightened onto the sheet's own
geometry (perspective warp), and every box is cropped with a small inset so
the printed border never reaches the crop. Crops keep their natural paper and
ink (not whitened), exactly like a questioned photo, so references and
questioned signatures look alike to the model (see capture.py).

Why 10 boxes: ForgeBlock needs at least 7 genuine references for a personal
threshold (MIN_ADAPTIVE_SAMPLES); 20 are recommended, so a client fills two
sheets, ideally on different days (signatures vary between sittings, and the
references should show that). One sheet leaves room to drop smudged boxes
and still reach 7.

Why practice boxes (v8.17): in the enrollment test on the own static dataset,
leaving out each person's first two signatures of the sitting lowered the
skilled-forgery EER with the per-client check from 18.0% to 15.9% (10 refs).
The first signatures of a sitting are often stiffer than the rest.

Sheets printed before v8.17 (10 taller boxes, no practice row) still import:
the layout is recognised from where the printed box borders are.

All geometry is in inches from the top-left page corner, shared by the PDF
drawing, the test raster and the crop.
"""
import cv2
import numpy as np

PAGE_W, PAGE_H = 8.5, 11.0  # short bond, portrait
COLS, ROWS = 2, 5
BOXES = COLS * ROWS  # reference boxes (practice boxes are extra)
BOX_W = 3.55
GRID_X = (PAGE_W - COLS * BOX_W) / 2
# Box grid of each printed layout: top of the reference grid, box height, and
# whether the sheet has the practice row. "v2" is printed from v8.17 on.
LAYOUTS = {
    "v2": {"grid_y": 3.03, "box_h": 1.40, "practice": True},
    "v1": {"grid_y": 1.75, "box_h": 1.62, "practice": False},
}
LAYOUT = "v2"
GRID_Y, BOX_H = LAYOUTS[LAYOUT]["grid_y"], LAYOUTS[LAYOUT]["box_h"]
PRACTICE = 2
PRACTICE_Y, PRACTICE_H = 1.82, 0.85
MARK = 0.32  # corner square side
MARK_POS = {  # top-left corner of each square
    "tl": (0.30, 0.30),
    "tr": (PAGE_W - 0.30 - MARK, 0.30),
    "br": (PAGE_W - 0.30 - MARK, PAGE_H - 0.30 - MARK),
    "bl": (0.30, PAGE_H - 0.30 - MARK),
}
INSET = 0.08  # trimmed from each box edge when cropping
LABEL_W, LABEL_H = 0.30, 0.22  # box number area (top-left of each box), blanked in crops
WORK_DPI = 200  # resolution of the straightened sheet


class SheetError(ValueError):
    pass


def box_rect(index: int, layout: str = LAYOUT) -> tuple[float, float, float, float]:
    """(x, y, w, h) in inches of reference box 1..10, numbered left to right, top to bottom."""
    g = LAYOUTS[layout]
    r, c = divmod(index - 1, COLS)
    return GRID_X + c * BOX_W, g["grid_y"] + r * g["box_h"], BOX_W, g["box_h"]


def practice_rect(index: int) -> tuple[float, float, float, float]:
    """(x, y, w, h) of practice box 1..2 (warm-up signatures, never cropped)."""
    return GRID_X + (index - 1) * BOX_W, PRACTICE_Y, BOX_W, PRACTICE_H


def mark_centers(dpi: int) -> np.ndarray:
    return np.float32([[(x + MARK / 2) * dpi, (y + MARK / 2) * dpi]
                       for x, y in (MARK_POS[k] for k in ("tl", "tr", "br", "bl"))])


# ------------------------------------------------------------------ PDF ---

def _pdf_text(s: str) -> str:
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(client_code: str) -> bytes:
    """A one-page vector PDF (no extra libraries). y is flipped: PDF origin is bottom-left."""
    pt = 72.0
    H = PAGE_H * pt
    ops = []

    def rect(x, y, w, h, fill=False, width=1.2, gray=0.0):
        ops.append(f"{gray:.2f} G {gray:.2f} g {width:.2f} w {x * pt:.2f} {H - (y + h) * pt:.2f} "
                   f"{w * pt:.2f} {h * pt:.2f} re {'f' if fill else 'S'}")

    def text(x, y, s, size=10, bold=False, gray=0.0):
        font = "F2" if bold else "F1"
        ops.append(f"BT {gray:.2f} g /{font} {size} Tf {x * pt:.2f} {H - y * pt:.2f} Td ({_pdf_text(s)}) Tj ET")

    for x, y in MARK_POS.values():
        rect(x, y, MARK, MARK, fill=True)
    left = GRID_X
    text(left, 0.95, "ForgeBlock signature enrollment sheet", 15, bold=True)
    text(left, 1.20, f"Client: {client_code}" + "      Date: ____________      Sheet ___ of ___"
                     "      Examiner initials: ______", 9.5)
    text(left, 1.42, "Sign the way you normally sign, with a dark pen, keeping each signature inside its border. "
                     "Start with the two practice boxes.", 8.5, gray=0.35)
    text(left, PRACTICE_Y - 0.08, "PRACTICE  (warm-up, not used)", 8, bold=True, gray=0.45)
    for i in range(1, PRACTICE + 1):
        x, y, w, h = practice_rect(i)
        rect(x, y, w, h, width=0.8, gray=0.55)
        text(x + 0.07, y + 0.17, f"P{i}", 8, gray=0.55)
    text(left, GRID_Y - 0.10, "REFERENCE SIGNATURES  1 to 10", 8, bold=True)
    text(left + 2.35, GRID_Y - 0.10, "20 signatures are recommended: fill a second sheet, ideally on another day.",
         8, gray=0.35)
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i)
        rect(x, y, w, h, width=1.1)
        text(x + 0.07, y + 0.17, str(i), 8, gray=0.45)
    y_end = GRID_Y + ROWS * BOX_H
    text(left, y_end + 0.32, "Photograph the whole page flat, in good light, with all four black squares visible. "
                             "Do not write near the squares.", 8, gray=0.35)
    content = "\n".join(ops).encode("latin-1")

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W * pt:.0f} {H:.0f}] "
         f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>").encode(),
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def render_raster(dpi: int = 150, layout: str = LAYOUT) -> np.ndarray:
    """The same sheet as a grayscale image (used by the tests)."""
    img = np.full((round(PAGE_H * dpi), round(PAGE_W * dpi)), 255, np.uint8)
    px = lambda v: round(v * dpi)  # noqa: E731
    for x, y in MARK_POS.values():
        cv2.rectangle(img, (px(x), px(y)), (px(x + MARK), px(y + MARK)), 0, -1)
    if LAYOUTS[layout]["practice"]:
        for i in range(1, PRACTICE + 1):
            x, y, w, h = practice_rect(i)
            cv2.rectangle(img, (px(x), px(y)), (px(x + w), px(y + h)), 120, max(1, px(0.011)))
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i, layout)
        cv2.rectangle(img, (px(x), px(y)), (px(x + w), px(y + h)), 0, max(1, px(0.015)))
        cv2.putText(img, str(i), (px(x + 0.07), px(y + 0.17)), cv2.FONT_HERSHEY_SIMPLEX, dpi / 400, 110, 1)
    return img


# --------------------------------------------------------------- import ---

def _order(pts: np.ndarray) -> np.ndarray:
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.float32([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])


def find_marks(gray: np.ndarray) -> np.ndarray:
    """Centers of the four corner squares: solid, square, dark blobs nearest each image corner."""
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # Adaptive threshold copes with phone shadows better than one global cut.
    bw = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV,
                               max(31, (min(h, w) // 20) | 1), 20)
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    page_area = w * h
    cands = []
    for c in contours:
        area = cv2.contourArea(c)
        # A mark is ~0.1% of the page; allow the page to fill 20-100% of the photo.
        if not (page_area * 0.00015 < area < page_area * 0.006):
            continue
        (cx, cy), (rw, rh), _ = cv2.minAreaRect(c)
        if min(rw, rh) == 0 or max(rw, rh) / min(rw, rh) > 1.5:
            continue
        hull = cv2.contourArea(cv2.convexHull(c))
        if hull == 0 or area / hull < 0.88 or area / (rw * rh) < 0.78:
            continue
        cands.append((cx, cy, area))
    if len(cands) < 4:
        raise SheetError("Could not find the four black corner squares. Photograph the whole page, flat, "
                         "with all four squares visible.")
    pts = np.float32([(x, y) for x, y, _ in cands])
    picked = []
    for corner in np.float32([[0, 0], [w, 0], [w, h], [0, h]]):
        picked.append(pts[np.argmin(np.linalg.norm(pts - corner, axis=1))])
    picked = np.float32(picked)
    if len({tuple(p) for p in picked.tolist()}) < 4:
        raise SheetError("The corner squares are unclear. Retake the photo with only the sheet in view.")
    quad = _order(picked)
    # Sanity check: the four squares must form a reasonably large, convex page.
    if cv2.contourArea(quad) < 0.15 * page_area or not cv2.isContourConvex(quad.reshape(-1, 1, 2)):
        raise SheetError("The sheet is too small or tilted in the photo. Hold the phone straight above the page.")
    return quad


def _border_score(sheet: np.ndarray, layout: str, dpi: int) -> float:
    """How dark the page is where this layout prints its reference box borders
    (middle part of each horizontal border line). The printed layout scores high."""
    vals = []
    t = max(1, round(0.025 * dpi))
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i, layout)
        x0, x1 = round((x + 0.25 * w) * dpi), round((x + 0.75 * w) * dpi)
        for yy in (y, y + h):
            c = round(yy * dpi)
            strip = sheet[max(0, c - t):c + t + 1, x0:x1]
            if strip.size:
                vals.append(float((strip.min(axis=0) < 150).mean()))
    return float(np.mean(vals)) if vals else 0.0


def _orientation(sheet: np.ndarray, dpi: int) -> tuple[str, bool]:
    """(layout, upside_down) whose printed box borders best match this sheet.
    Neither grid is symmetric under a half turn, so the borders tell both."""
    flipped = cv2.rotate(sheet, cv2.ROTATE_180)
    scores = {(k, f): _border_score(flipped if f else sheet, k, dpi) for k in LAYOUTS for f in (False, True)}
    return max(scores, key=scores.get)


def detect_layout(sheet: np.ndarray, dpi: int = WORK_DPI) -> str:
    """Which printed layout this straightened sheet is (either way up)."""
    return _orientation(sheet, dpi)[0]


def straighten(img: np.ndarray, dpi: int = WORK_DPI) -> np.ndarray:
    """Warp a photo or scan of the sheet onto the sheet geometry (grayscale, portrait, upright).
    Which way up it is comes from where the printed box borders are."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if gray.shape[1] > gray.shape[0]:  # photographed sideways
        gray = cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
    src = find_marks(gray)
    size = (round(PAGE_W * dpi), round(PAGE_H * dpi))
    m = cv2.getPerspectiveTransform(src, mark_centers(dpi))
    sheet = cv2.warpPerspective(gray, m, size, flags=cv2.INTER_AREA, borderValue=255)
    if _orientation(sheet, dpi)[1]:
        sheet = cv2.rotate(sheet, cv2.ROTATE_180)
    return sheet


def clean_signature(cell: np.ndarray) -> np.ndarray:
    """Same clean-up for every crop: flat white paper, grey-tone ink, show-through and specks removed."""
    gray = cell if cell.ndim == 2 else cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    k = max(3, (min(gray.shape) // 6) | 1)
    bg = cv2.medianBlur(gray, min(k, 51))
    norm = cv2.divide(gray, bg, scale=255)
    t, _ = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    white = min(250.0, t + 0.5 * (255 - t))
    dark = norm[norm < t]
    black = float(np.percentile(dark, 5)) if dark.size else 0.0
    out = np.clip((norm.astype(np.float32) - black) / max(1.0, white - black) * 255, 0, 255).astype(np.uint8)
    mask = (out < 200).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= max(12, int(0.00004 * mask.size))
    out[~keep[lab]] = 255
    return out


def touches_edge(ink: np.ndarray) -> bool:
    """True when the signature runs into the edge of its crop on some side, so
    part of it was probably written over the box border and cut off. A line
    along a whole side (a printed border seen through a slightly off crop) does
    not count."""
    e = max(2, round(min(ink.shape) * 0.012))
    for strip in (ink[:e, :], ink[-e:, :], ink[:, :e].T, ink[:, -e:].T):
        hit = strip.any(axis=0)
        frac = float(hit.mean())
        if hit.sum() >= 3 and frac < 0.5:
            return True
    return False


def crop_boxes(sheet: np.ndarray, dpi: int = WORK_DPI, layout: str | None = None) -> list[dict]:
    """Crop the 10 reference boxes (practice boxes are skipped). Each item:
    index, image (natural grayscale crop), empty, cut_off.

    The crop keeps the paper and ink as photographed (only the box number is
    painted over with the paper colour). It is not whitened: questioned photos
    are not whitened either, and the model scores best when references and
    questioned images look alike (see capture.py). The cleaned copy is only used
    to decide whether a box is empty or the signature runs off the box."""
    layout = layout or detect_layout(sheet, dpi)
    out = []
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i, layout)
        x0, y0 = round((x + INSET) * dpi), round((y + INSET) * dpi)
        x1, y1 = round((x + w - INSET) * dpi), round((y + h - INSET) * dpi)
        crop = sheet[y0:y1, x0:x1].copy()
        if crop.ndim == 3:
            crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        ly, lx = round((LABEL_H - INSET + 0.04) * dpi), round((LABEL_W - INSET + 0.04) * dpi)
        paper = float(np.median(crop[ly:, lx:]))
        crop[:ly, :lx] = int(round(paper))
        mask = clean_signature(crop) < 128
        empty = float(mask.mean()) < 0.0015
        out.append({"index": i, "image": crop, "empty": empty, "cut_off": (not empty) and touches_edge(mask)})
    return out


def import_sheet(img: np.ndarray) -> list[dict]:
    sheet = straighten(img)
    return crop_boxes(sheet, layout=detect_layout(sheet))
