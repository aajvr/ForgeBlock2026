# ForgeBlock v8.5 - calibrated confidence (backend only)

Extract this zip over your ForgeBlock folder (replace files), then restart the backend.
No frontend files are touched, so your redesigned UI is safe. No database change.
Do NOT apply v8.4 (it is replaced by this update).

What changes
- Confidence = calibrated probability (Platt / logistic calibration, Platt 1999):
  P(genuine) = 1 / (1 + exp(-(a*z + b))), z = how far past the client's personal threshold,
  in units of the client's own variation (same z as before).
- Result: Consistent if P(genuine) >= upper edge, Inconsistent if <= 0.35, Inconclusive in between.
  Band per module in calibration.json ("band"): dynamic 0.35-0.80, static 0.35-0.65.
  Fallback for a module without a band: env CALIBRATED_BAND="0.35,0.80".
- Shown confidence = probability of the shown result (e.g. "88% confident it matches").
- a and b live in backend/weights/calibration.json, per model. A model with no entry keeps the
  old v8.2 confidence, so nothing breaks.
  * Dynamic (FB-DYN-E2 v1 / OWN_E2): a=1.307, b=1.353, fitted on the 13 writers this model never saw.
  * Static (SigNet, fingerprint 1395aa164620db5c): a=1.6705, b=-1.5608, fitted on CEDAR
    writers 39-55 (the model's validation + test writers, never trained on; 646 screenings). The BHSig260 fit (a=1.7578, b=-2.3398) is kept
    under "_alternatives". Provisional: refit on your own static sheets later.

Files
- backend/app/ml/decision.py, screening.py, engine.py, dynamic_model.py
- backend/weights/calibration.json (new)
- backend/tests/test_v85.py (new), training/calibrate_static.py (new)

Check: the backend log on start says "dynamic confidence: calibrated (model fingerprint thr:0.364863)".
and "static confidence: calibrated (model fingerprint 1395aa164620db5c)".
If one says uncalibrated, your model file differs from the one calibrated: copy the fingerprint
from the log line (or the block printed at the end of the Colab run) into calibration.json.
