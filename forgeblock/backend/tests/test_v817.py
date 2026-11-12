"""v8.17: enrollment sheet with practice boxes, old sheets still import, cut-off
boxes flagged, 20 recommended / 30 maximum references, sitting tip."""
import cv2
import numpy as np
from test_api import signature_png

from app.config import MAX_REFERENCES, RECOMMENDED_REFERENCES
from app.ml import enroll_sheet as S
from app.routers.common import threshold_strength


def _sig(seed, w, h):
    sig = cv2.imdecode(np.frombuffer(signature_png(seed), np.uint8), cv2.IMREAD_GRAYSCALE)
    return cv2.resize(sig, (w, h))


def _sheet(layout, practice_ink=False, overflow_box=None, dpi=200):
    page = S.render_raster(dpi, layout)
    for i in range(1, S.BOXES + 1):
        x, y, w, h = S.box_rect(i, layout)
        if i == overflow_box:  # signature written past the right border
            x0, y0, W, H = round((x + 1.5) * dpi), round((y + 0.3) * dpi), round(2.6 * dpi), round((h - 0.5) * dpi)
        else:
            x0, y0, W, H = round((x + 0.4) * dpi), round((y + 0.3) * dpi), round((w - 0.8) * dpi), round((h - 0.5) * dpi)
        page[y0:y0 + H, x0:x0 + W] = np.minimum(page[y0:y0 + H, x0:x0 + W], _sig(i, W, H))
    if practice_ink:
        for i in range(1, S.PRACTICE + 1):
            x, y, w, h = S.practice_rect(i)
            x0, y0, W, H = round((x + 0.3) * dpi), round((y + 0.2) * dpi), round((w - 0.6) * dpi), round((h - 0.35) * dpi)
            page[y0:y0 + H, x0:x0 + W] = np.minimum(page[y0:y0 + H, x0:x0 + W], _sig(99, W, H))
    return page


def test_new_sheet_skips_practice_boxes():
    page = _sheet("v2", practice_ink=True)
    assert S.detect_layout(page) == "v2"
    boxes = S.import_sheet(cv2.cvtColor(page, cv2.COLOR_GRAY2BGR))
    assert [b["index"] for b in boxes] == list(range(1, 11))
    assert not any(b["empty"] or b["cut_off"] for b in boxes)
    # Upside-down photo of the new sheet still comes out in order and upright.
    flipped = S.import_sheet(cv2.rotate(page, cv2.ROTATE_180))
    assert all(abs(float(a["image"].mean()) - float(b["image"].mean())) < 1.5 for a, b in zip(boxes, flipped))


def test_old_sheet_still_imports():
    page = _sheet("v1")
    assert S.detect_layout(page) == "v1"
    assert S.detect_layout(cv2.rotate(page, cv2.ROTATE_180)) == "v1"
    boxes = S.import_sheet(page)
    assert len(boxes) == 10 and not any(b["empty"] or b["cut_off"] for b in boxes)
    assert all(b["empty"] for b in S.import_sheet(S.render_raster(200, "v1")))


def test_cut_off_signature_is_flagged():
    boxes = S.import_sheet(_sheet("v2", overflow_box=4))
    assert [b["index"] for b in boxes if b["cut_off"]] == [4]


def test_pdf_has_practice_row():
    pdf = S.render_pdf("CLU-001")
    assert b"PRACTICE" in pdf and b"20 signatures are recommended" in pdf


def test_reference_counts_and_notes():
    assert (RECOMMENDED_REFERENCES, MAX_REFERENCES) == (20, 30)
    ready = threshold_strength(10, sittings=1)
    assert ready["level"] == "basic" and "more reliable" in ready["note"]
    assert ready["sitting_tip"] and "another day" in ready["sitting_tip"]
    assert threshold_strength(10, sittings=2)["sitting_tip"] is None
    strong = threshold_strength(20, sittings=2)
    assert strong["level"] == "strong" and "up to 30" in strong["note"]
    assert threshold_strength(30, sittings=1)["sitting_tip"] is None


def test_sitting_count():
    from datetime import datetime, timedelta
    from types import SimpleNamespace

    from app.routers.common import sitting_count
    t0 = datetime(2026, 11, 11, 9, 0)
    same = [SimpleNamespace(enrolled_at=t0 + timedelta(minutes=m)) for m in range(10)]
    assert sitting_count(same) == 1
    two = same + [SimpleNamespace(enrolled_at=t0 + timedelta(days=2, minutes=m)) for m in range(5)]
    assert sitting_count(two) == 2 and sitting_count([]) == 0
