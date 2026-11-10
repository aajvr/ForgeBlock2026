# ForgeBlock v8.11 - Dynamic signatures without pen pressure or tilt

Dynamic references and screenings now ACCEPT signatures that have no pen
pressure and/or no pen tilt (finger, mouse, a stylus that is not an Apple
Pencil, a pen without tilt). Nothing is rejected for missing pen data any more.

## What you see
- While signing: a notice above the pad, and right after a signature without
  pen data: "This signature has no pen pressure or tilt ... labelled
  'Limited pen data'".
- Signature card: each such reference gets a "Limited pen data" badge; after
  saving, a notice says how many were saved without pen data.
- Result page (staff AND client view): a "Limited pen data" banner that says
  what was missing (questioned signature and/or references) and that the
  result is less certain than an Apple Pencil screening.
- Records list: "Limited pen data" badge next to the module.

## How it compares (backend/app/routers/pen_data.py)
Two signatures are always compared on the pen data BOTH have:
full / no_tilt / no_pressure / basic. Each dynamic reference stores its
embedding in every mode it can take part in (features["_pen"]), so screening
does not need the reference strokes. If at least 5 references (or all) have
the same pen data as the questioned signature, only those are used in that
mode; otherwise every reference is used in the mode that leaves out
everything any of them lacks. Pencil-to-Pencil screenings are unchanged.

## Accuracy (own 65 users, 5 references, optimistic: users were in training)
| Mode | EER |
|---|---|
| Full (Apple Pencil) | 4.5% |
| No pressure | 5.8% |
| No tilt (main model, tilt left out) | 21.8% |
| No pressure + no tilt (main model) | 24.2% |
| No pressure + no tilt (OWN_E3 model) | 14.4% |

Without tilt the main model gets much worse, so v8.11 can use a second model
trained without pressure and tilt (the notebook's OWN_E3):
1. In Colab, C810: EXPERIMENT = "OWN_E3", run, download the zip.
2. Take best_model.pt from it and save it as
   backend/weights/dynamic_encoder_basic.pt
3. Restart the backend. It is used automatically for every comparison
   without tilt (thresholds come from its own checkpoint).
Without that file, the main model is used with the missing channels left out.

## After installing (required)
Admin > Re-embed references, once, on the computer that enrolled the
references (it stores the per-mode embeddings). Adding or removing
dynamic_encoder_basic.pt also needs a re-embed. Older references keep
working for Apple Pencil screenings until then.

## Notes
- DEV_PEN_DEVICES is no longer needed (no-tilt pens are always accepted).
  Older "development" references/records show as "Limited pen data".
- tests: backend/tests/test_v811.py (+ updated test_dynamic_svc.py).
  The two test_v84.py failures are older (v8.5 changed that rule) and not
  caused by this update.
