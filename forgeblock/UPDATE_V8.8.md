# ForgeBlock v8.8: questioned signature matched to the references' size

Backend only. Apply on top of v8.7.

## Problem
The preprocessing (kept identical to training) uses fixed pixel-size filters,
so the same signature photographed close-up (about 3x larger than the sheet
references) looked like different writing: genuine -> Inconsistent.

## Fix
- `backend/app/ml/capture.py`: `signature_width()` measures the signature;
  `match_size()` scales the QUESTIONED image so its signature is as wide as
  the median of the client's references (left alone within +/-15 %).
  References are never rescaled.
- `backend/app/routers/verification.py`: static screening applies it before
  quality check and embedding; the stored questioned image is the matched one;
  the scale used is kept in the record analysis (`size_scale`).
- `backend/tests/test_v861.py`: size-match tests.

## Test results (SigNet, app decision, 10-box sheet, leave-one-out)
| Questioned vs phone-sheet references | Consistent / Inconclusive / Inconsistent |
|---|---|
| close-up 3x larger, before | mostly Inconsistent |
| close-up 3x larger, v8.8 | 7 / 3 / 0 |
| half size, v8.8 | 6 / 2 / 2 |
CEDAR test writers 47-55: AUC 0.981 -> 0.977, EER 8.4% -> 9.9%,
skilled forgeries marked Consistent 0% (unchanged).
Resizing ALL images to one fixed size was rejected (CEDAR AUC 0.80, 27% forgeries passed).

Note: the "What the model sees" preview on the Screen page is shown before a
client is chosen, so it does not include this size step.
