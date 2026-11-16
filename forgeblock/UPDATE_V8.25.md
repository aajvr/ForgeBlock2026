# ForgeBlock v8.25: fixed background for the static per-client check, adaptive size matching

## Why

On 2026-11-16 genuine phone photos that used to be Consistent or Inconclusive came out Inconsistent on the deployed app. The records showed two causes, neither of them the model:

1. **The per-client check (v8.10) used every active client as "other people".** The set grew from 12 to 28 clients in four days, so results drifted. Worse, the same signer was enrolled twice (CL-001 and Tim Drake: their references are 0.79 similar, other people 0.31-0.36). The check then treated the person's own second record as "someone else who signs like this" and pushed genuine signatures down (cosine 0.697 above the personal threshold 0.632, distance-only 40 %, after the check 27 % -> Inconsistent).
2. **Size matching was switched off by default in v8.22.** Phone photos about 2x larger than the sheet references then scored lower.

## What changed

**Fixed background set.** The per-client check now compares against a fixed set of 12 participants of the own static dataset (10 references each), never against live clients. Chosen by a rule (`training/build_static_background.py`):

- only participants the v8.16 model was trained on: never its 11 test participants (Chapter 5 stays independent) or its 8 validation participants;
- never anyone enrolled as a client (participants 1-10, 12, 16, 19, 23, 28, 31, 43, 46 excluded);
- 12 drawn with seed 7 from the 23 eligible: P14, P21, P27, P34, P35, P39, P41, P45, P49, P50, P53, P54;
- genuine signatures 1-10, embeddings only (no images).

The set is stored in the database (setting `static_background`), NOT in GitHub, because embeddings are personal data. It is used only while the static model it was built with is loaded (fingerprint `b0b133c0f00d622e`). Without it the app uses the distance method only. The model, thresholds and calibration are unchanged.

**Adaptive size matching (default).** The questioned image is resized only when it is more than 2x larger or smaller than the references (the same rule as the amber capture notice). Normal uploads are untouched. Admins can choose Adaptive / Always / Off in Policy and retention (audited). The old v8.22 on/off switch is retired: after this update every PC uses Adaptive until an admin changes it.

**Both results when resized.** When a screening was resized, the original size is screened too. The official result stays the resized one; the capture notice and the details show "Without resizing: Inconsistent, chance genuine about 27 %". One ledger record.

## Check (CPU, own static dataset, v8.16)

10 held-out participants never seen by the model (1, 3, 11, 15, 16, 24, 25, 29, 42, 47), references = genuine 1-10, screened = genuine 11-20 (100) and 20 skilled forgeries each (200), app decision (personal thresholds, Platt calibration, band 0.35-0.65):

| Background of the per-client check | Genuine C / ? / X | Skilled forgeries C / ? / X | EER | AUC |
|---|---|---|---|---|
| none (distance only) | 45 / 39 / 16 % | 4.5 / 30.5 / 65 % | 26.0 % | 0.852 |
| live clients (enrolled DS participants, like before) | 55 / 26 / 19 % | 5 / 7 / 88 % | 15.5 % | 0.917 |
| other test people (how the calibration was fitted) | 55 / 31 / 14 % | 4.5 / 13 / 82.5 % | 16.5 % | 0.915 |
| **fixed 12 x 10 (v8.25)** | **55 / 29 / 16 %** | **5 / 12 / 83 %** | **16.0 %** | **0.915** |
| fixed 12 x 20 | 55 / 28 / 17 % | 5 / 10 / 85 % | 16.5 % | 0.918 |

The fixed set behaves like the set-up the calibration was fitted with, so no recalibration is needed; 20 references per person gave no gain. Five other seeds for the draw: genuine Consistent 55-61 %, forgeries accepted 5-8 %.

Adaptive size matching on the same data fires on 4 of 300 screenings (all forgeries 0.43-0.49x smaller); resizing them changed P(genuine) by at most 0.01 (all stay Inconsistent), so the dataset numbers above are unchanged.

## Install

1. Merge the PR (Azure redeploys the backend; Vercel the frontend). Local PCs: `git pull`, restart.
2. Store the background set ONCE in the shared database (the file is in the project files, `forgeblock/build/v8.25/static_background.json`, not in GitHub):

       cd backend
       python -m app.import_static_background path/to/static_background.json

   To rebuild it: `python training/build_static_background.py --data <static dataset> --exclude 1-10,12,16,19,23,28,31,43,46`. If more dataset participants are enrolled as clients later, add them to `--exclude`, rebuild and import again.
3. Keep one client per real person (duplicates no longer affect the check, but they still split a person's references).

## For the paper

- Ch3: the per-client check uses a fixed background set of 12 dataset participants (rule above), not the enrolled clients; adaptive size matching (resize only beyond 2x); when resized, the unresized result is also shown to the examiner.
- Ch5: the table above.
