"""v8.6: printable 10-box enrollment sheet + phone-photo import for static references."""
import cv2
import numpy as np
from conftest import make_user
from test_api import signature_png

from app.ml import enroll_sheet as S


def _signed_sheet_photo(seed: int = 1, flip: bool = True) -> bytes:
    """The sheet with a signature in every box, photographed tilted, shaded and upside down."""
    dpi = 150
    page = S.render_raster(dpi)
    for i in range(1, S.BOXES + 1):
        sig = cv2.imdecode(np.frombuffer(signature_png(seed, jitter=0.5 + 0.1 * i), np.uint8), cv2.IMREAD_GRAYSCALE)
        x, y, w, h = S.box_rect(i)
        x0, y0, W, H = round((x + 0.4) * dpi), round((y + 0.3) * dpi), round((w - 0.8) * dpi), round((h - 0.5) * dpi)
        page[y0:y0 + H, x0:x0 + W] = np.minimum(page[y0:y0 + H, x0:x0 + W], cv2.resize(sig, (W, H)))
    h, w = page.shape
    canvas = np.full((int(h * 1.35), int(w * 1.45)), 140, np.uint8)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[160, 120], [w + 220, 170], [w + 260, h + 230], [110, h + 160]])
    m = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(page, m, canvas.shape[::-1], borderValue=0)
    inside = cv2.warpPerspective(np.full_like(page, 255), m, canvas.shape[::-1]) > 0
    photo = np.where(inside, warped, canvas).astype(np.float32)
    photo = (photo * np.linspace(0.78, 1.0, photo.shape[1])[None, :]).clip(0, 255).astype(np.uint8)
    if flip:
        photo = cv2.rotate(photo, cv2.ROTATE_180)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(photo, cv2.COLOR_GRAY2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes()


def test_sheet_roundtrip_finds_ten_boxes_in_order():
    img = cv2.imdecode(np.frombuffer(_signed_sheet_photo(), np.uint8), cv2.IMREAD_COLOR)
    boxes = S.import_sheet(img)
    assert [b["index"] for b in boxes] == list(range(1, 11))
    assert not any(b["empty"] for b in boxes)
    # Sideways photo works too.
    assert not any(b["empty"] for b in S.import_sheet(cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)))
    # A blank sheet gives 10 empty boxes.
    blank = cv2.cvtColor(S.render_raster(150), cv2.COLOR_GRAY2BGR)
    assert all(b["empty"] for b in S.import_sheet(blank))


def test_pdf_is_valid_single_page():
    pdf = S.render_pdf("CLU-001")
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert b"/Count 1" in pdf and b"CLU-001" in pdf


def test_enrollment_sheet_endpoints(client, admin):
    ex = make_user(client, admin, "sheet@example.com")
    other = make_user(client, admin, "sheet2@example.com")
    cid = client.post("/api/clients", headers=ex, json={"full_name": "Sheet client"}).json()["id"]

    r = client.get(f"/api/clients/{cid}/static/enrollment-sheet", headers=ex)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert client.get(f"/api/clients/{cid}/static/enrollment-sheet", headers=other).status_code == 404

    photo = _signed_sheet_photo(3)
    r = client.post(f"/api/clients/{cid}/static/sheet-preview", headers=ex,
                    files={"file": ("sheet.jpg", photo, "image/jpeg")})
    assert r.status_code == 200, r.text
    boxes = r.json()["boxes"]
    assert len(boxes) == 10 and all(b["image"].startswith("data:image/png;base64,") for b in boxes)
    assert sum(b["usable"] for b in boxes) >= 8
    assert client.post(f"/api/clients/{cid}/static/sheet-preview", headers=other,
                       files={"file": ("sheet.jpg", photo, "image/jpeg")}).status_code == 404

    # Not a sheet (no corner squares): a clear message, nothing stored.
    r = client.post(f"/api/clients/{cid}/static/sheet-preview", headers=ex,
                    files={"file": ("x.png", signature_png(4), "image/png")})
    assert r.status_code == 422 and "corner" in r.json()["detail"]

    # The chosen crops are enrolled through the normal endpoint.
    import base64
    files = [("files", (f"box{b['index']:02d}.png", base64.b64decode(b["image"].split(",", 1)[1]), "image/png"))
             for b in boxes if b["usable"]][:6]
    r = client.post(f"/api/clients/{cid}/static/enroll", headers=ex, files=files)
    assert r.status_code == 200 and len(r.json()["accepted"]) == len(files)
