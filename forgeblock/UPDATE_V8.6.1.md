# ForgeBlock v8.6.1 / v8.6.2: printed lines in static photos

Backend-only fix. No frontend files, no database change, no new packages.

## Problem
A phone photo of a signature box kept the box's printed top and bottom lines.
The Chapter 3 preprocessing treats every dark mark as ink, so the crop
stretched to include both lines and the signature became small and faint in
"What the model sees". Also, sheet references were whitened while questioned
photos were not, so the two never looked alike.

## Fix
- NEW `backend/app/ml/capture.py`: erases long straight printed lines (box
  borders, ruled lines) by inpainting from the surrounding paper. Nothing else
  is changed: no crop, no resize, no whitening.
- `backend/app/routers/common.py`: every static upload (reference, questioned,
  "What the model sees", quality check) goes through it. The whole-sheet photo
  for the enrollment sheet is the only exception.
- `backend/app/ml/enroll_sheet.py`: sheet crops keep their natural paper and
  ink, like questioned photos (box number painted over with the paper colour).
- `backend/app/ml/preprocessing.py` is untouched (still identical to training).

## Test results (SigNet, CEDAR test writers 47-55, 10 references each)
| Treatment of every image | AUC | EER |
|---|---|---|
| none (plain scans) | 0.957 | 10.5% |
| erase printed lines (v8.6.1) | 0.956 | 11.1% |
| whiten paper (old sheet clean-up) | 0.861 | 24.6% |
| crop tight to the signature | 0.76-0.84 | 27-32% |
Simulated phone photos with box lines: AUC 0.70 -> 0.79 with the lines erased.
Whitened references vs a natural questioned photo: AUC 0.26 (mismatch).

## After applying
Delete the static references that came from the enrollment sheet (added with
v8.6, whitened) and add them again from the same sheet photo, so all
references and questioned photos get the same treatment.

## v8.6.2
Line removal now also catches slightly tilted and dashed box lines in
hand-held phone photos (v8.6.1 left pieces of them, which stretched the crop).
Same files as v8.6.1; only `backend/app/ml/capture.py` changed.
CEDAR test 47-55 with the app's decision: AUC 0.984 plain, 0.981 with v8.6.2,
skilled forgeries marked Consistent 0% in both.

Real 10-box sheet test (one writer, leave-one-out, v8.6.2):
- phone photo refs vs phone photo questioned, same framing: 6-8 of 10 Consistent, 0-1 Inconsistent
- Notebloc refs vs phone photo questioned: mostly Inconsistent (capture mismatch)
So enroll and screen with the same capture method and similar framing.
