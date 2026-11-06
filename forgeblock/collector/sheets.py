"""Paper sheets for the static dataset: printable template and scan import.

One sheet is short bond (8.5 x 11 in) in landscape with 20 signature boxes in
4 columns x 5 rows and a solid square corner mark near each page corner. On
import the four marks are found, the scan is straightened with a perspective
warp onto the template's own geometry, and each box is cropped with a small
inset so the printed border never reaches the crop.

Everything is measured in inches from the top-left page corner, so the
template drawing and the crop share one set of numbers.

    python sheets.py template --out sheet.pdf [--participant P003 --kind genuine]
    python sheets.py import scan.jpg --out crops/
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PAGE_W, PAGE_H = 11.0, 8.5  # landscape short bond
COLS, ROWS = 4, 5
BOX_W, BOX_H = 2.45, 1.38
GRID_X, GRID_Y = (PAGE_W - COLS * BOX_W) / 2, 1.15
MARK = 0.30  # corner mark side
MARK_POS = {  # top-left corner of each mark
    "tl": (0.20, 0.25),
    "tr": (PAGE_W - 0.20 - MARK, 0.25),
    "br": (PAGE_W - 0.20 - MARK, PAGE_H - 0.25 - MARK),
    "bl": (0.20, PAGE_H - 0.25 - MARK),
}
INSET = 0.07  # trimmed from each box edge when cropping
LABEL_W, LABEL_H = 0.30, 0.20  # box number area (top-left), blanked in crops

PRINT_DPI = 300
WORK_DPI = 200  # resolution of the straightened sheet used for cropping
BOXES = COLS * ROWS


def mark_centers(dpi: int) -> np.ndarray:
    return np.float32([[(x + MARK / 2) * dpi, (y + MARK / 2) * dpi] for x, y in (MARK_POS[k] for k in ("tl", "tr", "br", "bl"))])


def box_rect(index: int) -> tuple[float, float, float, float]:
    """(x, y, w, h) in inches for box 1..20, numbered left to right, top to bottom."""
    r, c = divmod(index - 1, COLS)
    return GRID_X + c * BOX_W, GRID_Y + r * BOX_H, BOX_W, BOX_H


def _font(size_px: int):
    try:
        return ImageFont.load_default(size=size_px)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


KIND_LABEL = {"genuine": "Genuine signatures", "forgery": "Forgeries"}


def render_template(participant: str = "", kind: str = "", target: str = "", dpi: int = PRINT_DPI) -> Image.Image:
    """Draw the sheet. Blank fields are left as lines to fill in by hand."""
    img = Image.new("L", (round(PAGE_W * dpi), round(PAGE_H * dpi)), 255)
    d = ImageDraw.Draw(img)
    px = lambda v: round(v * dpi)  # noqa: E731

    for x, y in MARK_POS.values():
        d.rectangle([px(x), px(y), px(x + MARK), px(y + MARK)], fill=0)

    big, small = _font(px(0.17)), _font(px(0.12))
    left = GRID_X
    d.text((px(left), px(0.30)), "ForgeBlock signature data collection", font=big, fill=0)
    kind_text = KIND_LABEL.get(kind, "Genuine  /  Forgery (circle one)")
    if kind == "forgery":
        kind_text += f" of {target or '________'}"
    fields = [
        f"Participant code: {participant or '__________'}",
        f"Sheet: {kind_text}",
        "Date: ____________",
    ]
    d.text((px(left), px(0.62)), "      ".join(fields), font=small, fill=0)
    d.text(
        (px(left), px(0.86)),
        "Sign once inside each box. Keep the signature inside the border. Do not write near the black corner squares.",
        font=small,
        fill=90,
    )

    num = _font(px(0.11))
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i)
        d.rectangle([px(x), px(y), px(x + w), px(y + h)], outline=0, width=max(2, px(0.012)))
        d.text((px(x + 0.06), px(y + 0.04)), str(i), font=num, fill=120)
    return img


def save_template(path: Path, **kw) -> Path:
    img = render_template(**kw)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".pdf":
        img.save(path, "PDF", resolution=PRINT_DPI)
    else:
        img.save(path, dpi=(PRINT_DPI, PRINT_DPI))
    return path


# ------------------------------------------------------------------ import ---


class SheetError(ValueError):
    pass


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    s, diff = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.float32([pts[np.argmin(s)], pts[np.argmin(diff)], pts[np.argmax(s)], pts[np.argmax(diff)]])


def find_marks(gray: np.ndarray) -> np.ndarray:
    """Centers of the four corner marks: the solid, square, dark blobs closest to each image corner."""
    h, w = gray.shape
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    # Expected mark area relative to the page, with a wide tolerance for crop and zoom.
    expected = (MARK / PAGE_W) * (MARK / PAGE_H) * w * h
    cands = []
    for c in contours:
        area = cv2.contourArea(c)
        if not (expected * 0.15 < area < expected * 6):
            continue
        (cx, cy), (rw, rh), _ = cv2.minAreaRect(c)
        if min(rw, rh) == 0 or max(rw, rh) / min(rw, rh) > 1.6:
            continue
        hull = cv2.contourArea(cv2.convexHull(c))
        if hull == 0 or area / hull < 0.85 or area / (rw * rh) < 0.75:
            continue
        cands.append((cx, cy))
    if len(cands) < 4:
        raise SheetError("Could not find the four black corner squares. Scan the whole page, flat, with all four corners visible.")
    cands = np.float32(cands)
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    picked = []
    for corner in corners:
        dist = np.linalg.norm(cands - corner, axis=1)
        picked.append(cands[np.argmin(dist)])
    picked = np.float32(picked)
    if len({tuple(p) for p in picked.tolist()}) < 4:
        raise SheetError("The corner squares are ambiguous. Rescan the page without other dark squares near the corners.")
    return _order_corners(picked)


def straighten(img: np.ndarray, dpi: int = WORK_DPI) -> np.ndarray:
    """Warp a scan or photo of the sheet onto the template geometry (grayscale, landscape)."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if gray.shape[0] > gray.shape[1]:  # scanned in portrait
        gray = cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
    src = find_marks(gray)
    size = (round(PAGE_W * dpi), round(PAGE_H * dpi))
    m = cv2.getPerspectiveTransform(src, mark_centers(dpi))
    sheet = cv2.warpPerspective(gray, m, size, flags=cv2.INTER_AREA, borderValue=255)
    # Upside down? Each box has its printed number in the top-left corner; after a
    # half turn the numbers sit in the bottom-right corners instead.
    def corner_ink(flipped: bool) -> float:
        total = 0.0
        for i in range(1, BOXES + 1):
            x, y, w, h = box_rect(i)
            if flipped:
                x, y = x + w - LABEL_W, y + h - LABEL_H
            x0, y0 = round((x + 0.03) * dpi), round((y + 0.03) * dpi)
            patch = sheet[y0:y0 + round((LABEL_H - 0.05) * dpi), x0:x0 + round((LABEL_W - 0.05) * dpi)]
            total += float((patch < 128).mean())
        return total

    if corner_ink(True) > corner_ink(False):
        sheet = cv2.rotate(sheet, cv2.ROTATE_180)
    return sheet


def crop_boxes(sheet: np.ndarray, dpi: int = WORK_DPI) -> list[dict]:
    """Crop the 20 boxes from a straightened sheet. Each item: index, image, ink, empty."""
    out = []
    for i in range(1, BOXES + 1):
        x, y, w, h = box_rect(i)
        x0, y0 = round((x + INSET) * dpi), round((y + INSET) * dpi)
        x1, y1 = round((x + w - INSET) * dpi), round((y + h - INSET) * dpi)
        crop = sheet[y0:y1, x0:x1].copy()
        # Blank the printed box number.
        crop[: round((LABEL_H - INSET + 0.03) * dpi), : round((LABEL_W - INSET + 0.03) * dpi)] = 255
        ink = float((crop < 128).mean())
        out.append({"index": i, "image": crop, "ink": ink, "empty": ink < 0.0008})
    return out


def import_sheet(data: bytes) -> tuple[np.ndarray, list[dict]]:
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise SheetError("That file is not an image. Upload a JPG, PNG or TIFF scan of the sheet.")
    sheet = straighten(img)
    return sheet, crop_boxes(sheet)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("template", help="write a printable sheet (PDF or PNG)")
    t.add_argument("--out", type=Path, default=Path("forgeblock-sheet.pdf"))
    t.add_argument("--participant", default="")
    t.add_argument("--kind", choices=["genuine", "forgery", ""], default="")
    t.add_argument("--target", default="")
    i = sub.add_parser("import", help="crop the 20 boxes from a scanned sheet")
    i.add_argument("scan", type=Path)
    i.add_argument("--out", type=Path, default=Path("crops"))
    args = ap.parse_args()
    if args.cmd == "template":
        print(save_template(args.out, participant=args.participant, kind=args.kind, target=args.target))
    else:
        sheet, boxes = import_sheet(args.scan.read_bytes())
        args.out.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.out / "sheet.png"), sheet)
        for b in boxes:
            cv2.imwrite(str(args.out / f"box{b['index']:02d}.png"), b["image"])
            print(f"box {b['index']:2d}  ink {b['ink']:.3f}{'  EMPTY' if b['empty'] else ''}")


if __name__ == "__main__":
    main()
