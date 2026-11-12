# ForgeBlock v8.14: "why is it Inconclusive?" explanation

Staff result page now says, in plain words, why a screening got its result:
- Under the result: e.g. "The chance that this signature is genuine is about 63%: it leans genuine,
  but it falls between 35% and 65%, too close to call either way, so an examiner should review it.
  Every score passed its threshold, but only by a little compared with how much this client's own
  signatures vary, and signatures that only just pass are often skilled forgeries."
- The (i) "How is this calculated?" help is rewritten for the calibrated confidence (the old text
  still described the v8.2 score and wrongly said it is not a probability), with a "This screening" line.
- Scores tab: when every metric passes but the result is not Consistent, a short note explains why.
Clients' limited view is unchanged (no explanation, no scores). No model, threshold or database change.

## Apply (from the repo root `ForgeBlock2026/`)
- Already applied v8.13?   `git apply forgeblock-v8.14.patch`
- Not yet applied v8.13?    `git apply forgeblock-v8.13-and-v8.14.patch` (both in one)
Restart the backend. Tests: `cd forgeblock/backend && python -m pytest -q` -> 69 passed, 1 skipped.
Frontend builds and lints clean.
