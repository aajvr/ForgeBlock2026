# ForgeBlock v8.7: crop step for questioned static signatures

Includes v8.6.2 (printed-line removal) plus a crop step on the Screen page.

## Why
Tests on a real 10-box sheet: a genuine signature photographed loosely
(box lines, extra paper) against sheet references came out Inconsistent;
framed like the sheet boxes and taken with the same capture method it came
out Consistent in 6-8 of 10. Forcing all images to look alike instead
(whiten + auto-crop) let 12% of CEDAR skilled forgeries through, so the
model is kept as is and the capture is made consistent.

## Files
- NEW frontend/src/components/SignatureCrop.jsx: crop dialog (drag a box,
  corner handles, works with touch; "Use whole photo" still possible).
- frontend/src/components/ImagePicker.jsx: new `crop` option; picked or
  photographed images open the crop dialog; "Crop again" uses the original photo.
- frontend/src/pages/Screen.jsx: ONE line, edit by hand (see steps), so your
  redesigned page is not overwritten.
- backend files from v8.6.2 (capture.py, enroll_sheet.py, common.py, clients.py, test_v861.py).

## Capture rule (for the examiner and Help Center)
Enroll references with the in-app enrollment sheet (phone) and photograph
questioned signatures with the same phone, then crop to the signature with a
little paper around it, like a sheet box. Do not mix Notebloc/scanner
references with phone-photo questioned signatures.
