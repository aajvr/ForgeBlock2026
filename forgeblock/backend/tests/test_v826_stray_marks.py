"""v8.26: automatic stray-mark removal (dots, dashes, splashes away from the signature)."""
import cv2
import numpy as np

from app.ml import stray_marks
from tests.test_api import signature_png


def _img(seed=1, jitter=0.6):
    return cv2.imdecode(np.frombuffer(signature_png(seed, jitter), np.uint8), cv2.IMREAD_COLOR)


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


def _dot(img, x, y, r=2):
    out = img.copy()
    cv2.circle(out, (x, y), r, (20, 20, 20), -1)
    return out


def _sig_box(img):
    m = stray_marks.ink_mask(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max(), ys.max()


def test_clean_image_is_returned_unchanged():
    img = _img()
    out, info = stray_marks.clean(img)
    assert out is img and info["removed"] == 0


def test_far_dot_is_removed_and_nothing_else():
    img = _img()
    dirty = np.vstack([img, np.full((120, img.shape[1], 3), 245, np.uint8)])
    dirty = _dot(dirty, 500, 320)                     # well below the signature
    out, info = stray_marks.clean(dirty)
    assert info["removed"] == 1 and info["far"] == 1
    assert out[315:326, 495:506].min() > 200          # dot painted with paper
    ink_before = (cv2.cvtColor(dirty, cv2.COLOR_BGR2GRAY) < 128)[:220].sum()
    ink_after = (cv2.cvtColor(out, cv2.COLOR_BGR2GRAY) < 128)[:220].sum()
    assert ink_before == ink_after                     # the signature itself is untouched


def test_big_separate_part_is_kept():
    """A separate word or initial holds more ink than a stray mark: never erased."""
    img = np.vstack([_img(), np.full((200, 520, 3), 245, np.uint8)])
    cv2.putText(img, "JD", (380, 380), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (20, 20, 20), 6)
    _, info = stray_marks.clean(img)
    assert info["removed"] == 0


def test_near_mark_needs_the_clients_other_signatures():
    wide = lambda im: np.hstack([im, np.full((im.shape[0], 180, 3), 245, np.uint8)])
    img = wide(_img())
    x0, y0, x1, y1 = _sig_box(img)
    spot = (int(x1 + 60), int((y0 + y1) / 2))      # inside the safety zone, separate from the strokes
    near = _dot(img, *spot, r=3)
    # Alone it stays (could be an i-dot); vs signatures that never have it, it goes.
    assert stray_marks.clean(near)[1]["removed"] == 0
    others = [stray_marks.near_positions(wide(_img(1, j))) for j in (0.5, 0.7, 0.9, 1.1)]
    out, info = stray_marks.clean(near, others)
    assert info["removed"] == 1 and info["near"] == 1
    # A habit (the same mark in most signatures) is kept.
    habit = [stray_marks.near_positions(_dot(wide(_img(1, j)), *spot, r=3)) for j in (0.5, 0.7, 0.9, 1.1)]
    assert stray_marks.clean(near, habit)[1]["removed"] == 0


def test_enrollment_and_screening_remove_marks_and_keep_the_original(client, examiner):
    r = client.post("/api/clients", headers=examiner, json={"full_name": "Stray Marks"})
    cid = r.json()["id"]
    clean_refs = [_img(1, 0.6 + 0.1 * i) for i in range(7)]
    tall = lambda im: np.vstack([im, np.full((120, im.shape[1], 3), 245, np.uint8)])
    files = [("files", (f"s{i}.png", _png(tall(im)), "image/png")) for i, im in enumerate(clean_refs)]
    files.append(("files", ("dot.png", _png(_dot(tall(_img(1, 0.65)), 500, 320)), "image/png")))
    r = client.post(f"/api/clients/{cid}/static/enroll", headers=examiner, files=files)
    assert r.status_code == 200, r.text
    removed = [a["stray_marks_removed"] for a in r.json()["accepted"]]
    assert removed == [0] * 7 + [1]

    q = _dot(tall(_img(1, 0.7)), 30, 320)
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                    files={"file": ("q.png", _png(q), "image/png")})
    assert r.status_code == 200, r.text
    s = r.json()["analysis"]["stray_marks"]
    assert s["removed"] == 1 and s["original_path"]
    r = client.post("/api/screen/static", headers=examiner, data={"client_id": cid},
                    files={"file": ("q.png", _png(tall(_img(1, 0.7))), "image/png")})
    assert r.json()["analysis"]["stray_marks"] is None
