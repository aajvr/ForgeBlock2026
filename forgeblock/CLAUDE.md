# ForgeBlock — notes for Claude Code

Capstone project (DLSU-D): signature **screening** web app with a static module (scanned images) and a dynamic module (live iPad + Apple Pencil signing), plus a SHA-256 hash-linked ledger for screenings and examiner findings. Roles are Admin, Examiner and Client; accounts are created by admins only (no self-registration), and the admin role is limited to `RESEARCH_TEAM_EMAILS`. `collector/` is a separate researcher-only data collection tool. The design is specified in the team's Chapters 3 and 4; keep behaviour aligned with them. `docs/paper-notes.md` lists where the code had to choose between conflicting statements in the chapters.

## Stack

- Backend: Python 3.11/3.12, FastAPI, SQLAlchemy 2 (SQLite by default, Supabase Postgres via `DATABASE_URL`), PyJWT + bcrypt auth.
- ML: TensorFlow/Keras for the static model (`backend/weights/static_model.keras`, the team's trained model — do not replace or retrain it without being asked); PyTorch for the dynamic model (`backend/weights/dynamic_encoder.pt`, the team's SVC2004 notebook model, with its code copied unchanged in `app/ml/svc_dynamic/` — keep it identical to the notebook; do not retrain or replace without being asked), the reference encoder and training scripts; OpenCV + NumPy.
- Frontend: React 19 + Vite 6 + Tailwind CSS 4 + react-router 7, plain JavaScript (no TypeScript).

## Commands

```bash
cd backend && uvicorn app.main:app --reload --port 8000   # API on :8000, docs at /docs
cd backend && pytest -q                                    # API tests (use a temp DB; no weights needed)
cd frontend && npm run dev                                 # UI on :5173, proxies /api to :8000
cd frontend && npm run build && npx eslint src
cd backend && python seed.py demo --admin-password <pw>     # synthetic demo data, empty DB only
cd collector && COLLECTOR_KEY=<key> uvicorn app:app --port 8100 && pytest -q
python training/evaluate_static.py --cedar <dir> --writers 46-55
python training/train_dynamic.py --svc <SVC2004/Task2>
```

## Architecture rules

- Static and dynamic modules are independent. Never fuse their scores or show a combined verdict.
- ForgeBlock screens, it does not decide. User-facing results are Consistent / Inconclusive / Inconsistent (`app/ml/screening.py`). Since v8.5 the confidence is CALIBRATED (Platt/logistic): the writer-dependent z-score (`decision._z_margin`, static = mean of the three metric z's, dynamic = cosine z) becomes P(genuine) = 1/(1+exp(-(a z + b))) with a, b per module in `backend/weights/calibration.json`, keyed by a model fingerprint (static: sha256[:16] of static_model.keras; dynamic: checkpoint enroll threshold). Decision P >= 0.5; shown confidence = probability of the shown result (cap 99); Inconclusive when P falls inside the module's band (static 0.35-0.65, dynamic 0.35-0.80). A model with no calibration entry falls back to the v8.2 z-score confidence with the `INCONCLUSIVE_BELOW` cut-off. Refit a, b on held-out writers with `training/calibrate_static.py`; never fit them on the model's training writers. There is no Evaluation page (removed in v8). Inconclusive/Inconsistent screenings auto-open a case (`services.record_verification`); only the examiner decides it, Genuine or Forged with notes, which closes the case. No second opinion, no Inconclusive finding. Repeat detection (`sample_hash`, `services.prior_decision`) only displays an earlier decision and never changes the model result. Keep the disclaimer wherever a result is shown.
- Wording rules from the team: say "confidence score" (not match score), plain language for end users, no model version shown to users, no chatbot, no user image/CSV export.
- Preprocessing in `app/ml/preprocessing.py` must stay identical to what the static model was trained with (Chapter 3 Algorithm 2). Training/evaluation scripts import it from the backend instead of copying it.
- Every static upload first goes through `app/ml/capture.py` (v8.6.1): long printed lines are inpainted away, nothing else. Do not add cropping, whitening or resizing there: tested on CEDAR, each lowered SigNet accuracy, and references and questioned images must always get the same treatment.
- All decisions go through `app/ml/decision.py`:
  - static: cosine ≥ τc, Euclidean ≤ τE, Manhattan ≤ τM, majority 2 of 3;
  - dynamic: mean cosine ≥ τc and mean Euclidean ≤ √(2(1 − τc));
  - adaptive thresholds when a client has ≥ `MIN_ADAPTIVE_SAMPLES` (5) references.
- There is no Compare page or heatmap any more (removed in v7).
- Static references can also come from the printable 10-box enrollment sheet (`app/ml/enroll_sheet.py`: vector PDF with four corner squares, client code only; phone photo or scan is straightened and cropped; crops keep natural paper/ink, not whitened). `/static/sheet-preview` stores nothing; the chosen crops go through the normal `/static/enroll`.
- Every screening must go through `services.record_verification`, which writes the `VerificationLog`, appends the ledger block, logs the activity and adds the case event. Findings are sealed with `ledger.finding_payload` in `routers/cases.py`. Do not write verification logs any other way, or the ledger will flag them.
- If a field is added to what a verification record means, add it to `ledger.verification_payload`. Changing that payload invalidates existing chains, so only do it on a fresh database.
- Stored embeddings carry `model_version`; verification only uses references from the currently loaded model. After changing a model, call `POST /api/admin/reembed`.
- The dynamic model is pluggable via `app/ml/dynamic_model.load_dynamic_model()`; keep that contract (`embed`, `trained`, `kind`, `source`).
- Access follows Chapter 3, Section 3.8 and is enforced in the backend, not just the UI: `security.require_roles` for pages, `app/access.py` for records. Clients see only their own record, in a limited form (`common.client_safe`: no metrics, thresholds or analysis); examiners see the clients of their one group (`User.group_id` = `Client.group_id`, one examiner per group, no overlap), ungrouped clients they registered, and clients shared with them (`ClientAccess`, read-only), with those clients' screenings and cases; admins (research team) see everything. Every new endpoint that returns clients, references, screenings or cases must go through `app/access.py`.
- Password users must change the temporary password, and in `STUDY_MODE` everyone must accept the research-use terms (`current_user`), before any other endpoint works. Microsoft/Google sign-in goes through Clerk (frontend loads clerk-js from the Clerk Frontend API, `src/clerk.js`); `POST /api/auth/oauth` verifies the Clerk session token (RS256 via JWKS, issuer, azp) and reads the verified email from Clerk's Backend API, and only signs in existing active accounts (invite-only). Supabase is only the database. Never add a self-registration, image download or export endpoint (a test checks for "export"/"download" paths).

## Data and privacy

Signature samples are personal research data covered by the study's consent forms. Never commit `backend/storage/`, `backend/*.db`, datasets under `data/` (including `collector/data/`), `eval_accounts.csv`, or `.env`. Use participant codes rather than names in exported data where possible.
