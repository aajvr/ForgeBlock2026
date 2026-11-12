"""v8.9: cleaned 'what the model sees' previews for references, sheet boxes and
questioned images. Display only: the stored images and the scores do not change."""
import base64

import cv2
import numpy as np
from test_api import _client_with_refs, signature_png
from test_v86 import _signed_sheet_photo


def _png(content: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)


def test_model_views(client, examiner, examiner2):
    cid = _client_with_refs(client, examiner)
    ref = client.get(f"/api/clients/{cid}", headers=examiner).json()["static_references"][0]["id"]

    original = client.get(f"/api/references/{ref}/image", headers=examiner)
    model = client.get(f"/api/references/{ref}/image?view=model", headers=examiner)
    assert original.status_code == 200 and model.status_code == 200
    assert model.headers["content-type"] == "image/png" and model.headers["cache-control"] == original.headers["cache-control"]
    assert _png(model.content).shape[:2] == (224, 224)
    assert _png(original.content).shape[:2] != (224, 224)  # the stored image is untouched
    assert client.get(f"/api/references/{ref}/image?view=raw", headers=examiner).status_code == 422
    assert client.get(f"/api/references/{ref}/image?view=model", headers=examiner2).status_code == 404

    res = client.post("/api/screen/static", headers=examiner, data={"client_id": str(cid)},
                      files={"file": ("q.png", signature_png(99), "image/png")}).json()
    r = client.get(f"/api/verifications/{res['id']}/image?view=model", headers=examiner)
    assert r.status_code == 200 and _png(r.content).shape[:2] == (224, 224)

    r = client.post(f"/api/clients/{cid}/static/sheet-preview", headers=examiner,
                    files={"file": ("sheet.jpg", _signed_sheet_photo(3), "image/jpeg")})
    boxes = r.json()["boxes"]
    for b in boxes:
        if b["empty"]:
            assert b["model_view"] is None
        else:
            img = _png(base64.b64decode(b["model_view"].split(",", 1)[1]))
            assert img.shape[:2] == (224, 224)
