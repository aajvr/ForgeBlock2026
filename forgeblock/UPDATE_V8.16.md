# ForgeBlock v8.16: static model trained with multi-day signatures (own + UTSig)

Weights only. No code, database or frontend change.

## What changes
The static module uses **model B**: the same MobileNetV3-Large recipe as v8.12, trained on
ForgeBlock's own static dataset **plus 80 UTSig participants** (UTSig = 115 people who signed
on 3 different days). Training pairs from UTSig use signatures from *different days*, so the
model learns a person's natural day-to-day variation. Thresholds, bounds and the confidence
calibration (plain and per-client check) are refitted for it.

| File | What |
|---|---|
| `backend/weights/static_model.keras` | new model, fingerprint **`b0b133c0f00d622e`** |
| `backend/weights/static_config.json` | new default thresholds + personal-threshold bounds |
| `tools/add_static_calibration_v816.py` + `tools/calibration_v816_entries.json` | ADDS the new model's calibration to `calibration.json` (keeps everything else) |

## Install (do it on ONE computer, push, then everyone pulls)
1. Back up: rename `backend/weights/static_model.keras` to `static_model_v812.keras` and
   `static_config.json` to `static_config_v812.json`.
2. Extract this zip into the `forgeblock` folder (the one that contains `backend/`).
3. From that `forgeblock` folder: `python tools/add_static_calibration_v816.py`
4. Restart the backend. The startup log must say
   `static confidence: calibrated (model fingerprint b0b133c0f00d622e)`.
5. Commit and push (`backend/weights/*` + `tools/*`). Every other computer: `git pull`,
   check the fingerprint (`python -c "import hashlib;print(hashlib.sha256(open('weights/static_model.keras','rb').read()).hexdigest()[:16])"`
   in `backend`, must print `b0b133c0f00d622e`), restart, check the same log line.
6. **References:** stored embeddings from the old model do not fit the new one.
   Only AFTER every computer has the new model: delete the test clients and enroll them
   again (recommended, use the v8.17 sheet), or run **Re-embed references** once
   (needs the reference images on that computer).

To go back: restore the two backed-up files, restart, Re-embed again (old calibration entries are kept).

## Results (people the model never saw)
Training test, 5 person-disjoint rounds (model A = own data only, same recipe as v8.12):

| | A (own only) | **B (own + UTSig)** |
|---|---|---|
| Own data: skilled EER | 26.3% | **24.3%** |
| Own data: per-person EER | 14.2% | **13.4%** |
| UTSig, day-1 refs vs day-3: skilled EER | 33.4% | **30.2%** |

External checks, distance only:

| | v8.12 | **v8.16** |
|---|---|---|
| CEDAR (55 writers, 10 refs): skilled AUC / EER | 0.852 / 23.6% | **0.855 / 23.7%** (same) |
| CEDAR: random-forgery EER | 8.5% | **6.2%** |
| UTSig 35 held-out, day 1 -> day 3: skilled AUC / EER | 0.722 / 34.7% | **0.776 / 27.1%** |

As the app decides (Consistent / Inconclusive / Inconsistent, band 0.35-0.65):

| | v8.12 | **v8.16** | **v8.16 + per-client check** |
|---|---|---|---|
| CEDAR genuine | 45 / 36 / 19 | 48 / 37 / 14 | 61 / 26 / 13 |
| CEDAR skilled forgeries | 2 / 13 / 85 | 2 / 24 / 74 | 4 / 14 / 82 |
| UTSig genuine, another day | 44 / 31 / 25 | 55 / 32 / 13 | 63 / 21 / 16 |
| UTSig skilled forgeries | 8 / 25 / 67 | 13 / 36 / 51 | 16 / 17 / 67 |
| Aa's signatures from another sitting | 15 / 42 / 43 | 37 / 32 / 32 | **53 / 32 / 15** |
| Aa's close-up photos (6) | 0 / 33 / 67 | 2 C / 2 ? / 2 X | **3 C / 1 ? / 2 X** |

(Aa = participant 1, never seen by v8.16; v8.12 had seen her. The 2 close-ups still
Inconsistent are against the one-sitting CL-0006 references.)

Calibration: plain a = 1.3581, b = -1.3802 (AUC 0.834); per-client a = 5.9089, b = -4.9117
(AUC 0.879); fitted on 855 screenings of unseen people (11 own + 35 UTSig), genuine weighted
0.75 x forgeries. Default thresholds (fewer than 7 refs): cosine 0.6512, Euclidean 0.8256,
Manhattan 10.6027. Bounds: cosine [0.175, 0.89], Euclidean [0.517, 1.322], Manhattan [6.634, 17.009].

**Trade-off to report honestly:** genuine signatures from other days are rejected much less
often, but more UTSig skilled forgeries land in Inconclusive or Consistent (Consistent 8% -> 13%
plain). Inconclusive cases go to the examiner, so the screening role is kept.

UTSig: Soleimani, Fouladi and Araabi, "UTSig: A Persian offline signature dataset", IET Biometrics 6(1), 2017.
