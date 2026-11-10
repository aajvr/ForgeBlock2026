# ForgeBlock v8.12: new static model trained on our own dataset

Weights only. No code, database or frontend change, so it is safe on top of
what is on `main` (v8.5-v8.8 + OWN_E2 + v8.11 limited pen data).

## What changes
The static module now uses the model trained on ForgeBlock's own 55-participant
static dataset (MobileNetV3-Large Siamese network, triplet loss), instead of the
CEDAR-trained SigNet. Thresholds and the confidence calibration are refitted for it.

| File | What |
|---|---|
| `backend/weights/static_model.keras` | new model (fingerprint `f5f7cf01b8c40d87`) |
| `backend/weights/static_config.json` | new default thresholds + adaptive-threshold bounds |
| `tools/add_static_calibration_v812.py` + `tools/calibration_v812_entries.json` | ADDS the new model's calibration to `calibration.json` (keeps everything else) |

## Install
1. Back up the old model: rename `backend/weights/static_model.keras` to
   `static_model_cedar_v8.2.keras` and `static_config.json` to `static_config_cedar_v8.2.json`.
2. Extract this zip over your ForgeBlock folder.
3. From the ForgeBlock folder: `python tools/add_static_calibration_v812.py`
4. Restart the backend. Admin > System should show static confidence "calibrated".
5. **Re-embed the stored references (required).** Embeddings saved with the old model
   do not fit the new one, and both models are named `static_model.keras`, so ForgeBlock
   cannot tell them apart on its own. As admin, use **Re-embed references** (Admin model
   page), or open http://localhost:8000/docs and run `POST /api/admin/reembed`.
   It recomputes every reference from the saved images (no re-enrolling needed);
   the answer lists how many were updated. Old screenings keep their stored results.

To go back: restore the two backed-up files, restart, and run Re-embed again (the old calibration entries were never removed).

## Results (unseen people, 5-fold person-disjoint, 10 references)
| | Current SigNet | New model | New model + per-client check (v8.10) |
|---|---|---|---|
| Skilled AUC | 0.753 | 0.849 | **0.914** |
| Skilled EER | 33.3% | 23.8% | **16.4%** (15.1% with 54 other clients) |
| Random-forgery EER | 13.8% | 2.9% | **0.8%** |
| Per-person EER | 22.9% | 15.0% | **13.0%** |
| Pair-wise skilled (32,450 pairs) | AUC 0.705, EER 35.7% | AUC 0.786, EER 28.8% | (n/a) |

Calibration (Platt, cross-validated over the 5 rounds, 1,650 screenings):
- plain: a = 1.9663, b = -2.4516, AUC 0.873, calibration error 3.9%.
  Genuine 50.5% Consistent / 32.4% Inconclusive / 17.1% Inconsistent; forgeries 5.4 / 20.6 / 74.0.
- per-client check: a = 6.3925, b = -5.4503, AUC 0.912, calibration error 1.3%.
  Genuine 61.1 / 22.4 / 16.5; forgeries 6.4 / 11.0 / 82.6.

## Important: per-client check (v8.10) is not on main yet
`main` does not have v8.10. The calibration above already contains the
per-client entry, but it is only used once v8.10 is merged. **Do not extract the
old v8.10 zip over main**: it would undo v8.11 (same files). It needs a proper
merge on GitHub.
