# ForgeBlock

**A Siamese-based bimodal signature screening system.** ForgeBlock screens a questioned signature against a client's signatures on file with two separate modules, static (scanned paper) and dynamic (live iPad signing), and seals every screening and every examiner finding in a SHA-256 hash-linked ledger.

ForgeBlock is a **screening and decision-support tool**, like a medical screening test. It does not decide whether a signature is genuine. Each screening is reported as:

| Screening result | Meaning |
| --- | --- |
| **Consistent** | Consistent with the client's references |
| **Inconclusive** | Too close to the thresholds to lean either way; examiner review needed |
| **Inconsistent** | Not consistent with the references; refer for examination |

An Inconclusive or Inconsistent screening opens a case by itself, and the **examiner** decides it: **Genuine** or **Forged**, with notes. That decision closes the case and is sealed in the ledger. *ForgeBlock is a screening tool and does not replace a qualified document examiner.* During the ForgeBlock study at DLSU-D, `STUDY_MODE=true` adds the research-use terms and research labels (see "Study mode" below).

| Module | Input | Model | Decision underneath the screening result |
| --- | --- | --- | --- |
| Static | Scanned or photographed signature | MobileNetV2 Siamese embedding (`backend/weights/static_model.keras`) | Cosine, Euclidean and Manhattan each voted against a threshold; majority 2 of 3 |
| Dynamic | Live signing on iPad + Apple Pencil | 1D-CNN + BiLSTM + attention Siamese encoder (team SVC2004 model) | Mean cosine ≥ τc **and** mean Euclidean ≤ √(2(1 − τc)) |

The two modules are never fused into one verdict.

## What is in the system

**Roles.** There is no self-registration. An administrator creates every account. People sign in with the email that was registered, by password (temporary password changed at first sign-in) or with Microsoft or Google. Accounts lock after 5 wrong passwords (15 minutes) and users are signed out after 15 minutes without activity. Anyone can check a receipt code on the sign-in page. A public landing page (`/`) explains the system; `/signin` is the one sign-in page for every role, and each role gets its own workspace colour, menu and badge. New users get a short guided tour (replay it from Help Center or Profile).

- **Examiner** (blue workspace), one per **client group** (folder, e.g. Lawyers, OSS, CCJE): **My work** (cases waiting for a decision, latest screenings, shortcuts), **Cases** (Needs decision / Decided; choose Genuine or Forged with notes; after a Genuine decision, add the signature as a new reference), **Clients** (their group's folder only; whole row clickable, right-click menu; signature cards with static and dynamic references, minimum 5, recommended 10, maximum 20), **Screen a signature**, **Records** (every screening with its result, decision and receipt code, with filters and totals), global search, notifications.
- **Administrator** (indigo workspace): dashboard, every examiner's cases and records with the examiner who handles each one, **Clients as group folders** (create a group, assign its one examiner, move clients between groups; right-click to delete, with a confirmation), ledger with daily auto-check and tamper demo, audit log, users and roles, policy and retention (retention and sign-in security), and **System** (health of models, database, storage and ledger, plus model upkeep: dynamic weights upload and re-embed). Model evaluation is done in the notebooks and `training/` scripts, not in the app.
- **Client** (teal portal): their assigned examiner, their signatures on file, every screening made on documents in their name with the examiner's decision, and a limited view of each screening (result, confidence score, examiner's decision, receipt and ledger proof; no metric scores, thresholds or handwriting analysis), report a problem, request deletion. A client account is created automatically when the client is registered with an email (the temporary password is shown once).
- **Everyone**: Profile (no profile pictures; initials only) and Help Center.

**Repeat signatures.** If the exact same file (or the same pen strokes) is screened again for the same client after an examiner decided it, the result shows that earlier decision, with its notes and case, and no new case is opened. The model's result itself never changes because of a decision.

**Result page.** The result, confidence score with a plain-language caption, the key facts (client, references compared, threshold type and strength, receipt), and the questioned signature next to the closest reference. **Show details** opens the scores and "How is this calculated?", handwriting features, zoom and grid, difference overlay (static) or stroke replay (dynamic), and the ledger proof. Before screening, a quality check and a "what the model sees" preview. Phones can take a photo directly.

**Confidence score (writer-dependent z-score, v8.2).** For each metric, how far past its threshold the signature is, counted in the client's own standard deviations (the spread of their reference-to-reference scores), converted with the normal curve (2Φ(z) − 1), averaged over the metrics and ×100, capped at 99. 0 = on the threshold, about 68% = 1 sd past it, about 87% = as close as the client's typical signature, 95% = 2 sd. A questioned signature identical to a reference on file is flagged as an exact match. Below the Inconclusive cut-off the screening is Inconclusive; the cut-off is `INCONCLUSIVE_BELOW` in `backend/.env` (default 20), set by the research team from the evaluation's error–reject table and not shown in the app. See `docs/paper-notes.md` §15.

**Groups.** Each client group has exactly one examiner and an examiner handles at most one group, so groups never overlap. An examiner sees only their group's clients, screenings and cases (plus ungrouped clients they registered). Clients an examiner registers go into their group; only admins move clients between groups.

**Data collection tool.** A separate researcher-only app in `collector/` for gathering the study dataset (see below). It is not part of ForgeBlock and participants never sign in.

## Access control and ethical use (Chapter 3, Section 3.8)

| Section 3.8 says | How ForgeBlock does it |
| --- | --- |
| Accounts are created only by the researchers; no public self-registration | No sign-up page or endpoint. Admins create accounts (one by one or EVAL-xx in bulk) with temporary passwords. |
| Administrator access is limited to the research team | The admin role can only be given to emails listed in `RESEARCH_TEAM_EMAILS` (plus `ADMIN_EMAIL`). Test accounts can never be admins. |
| Users can view only their own enrolled signatures and activity records | Enforced in the backend (`app/access.py`) on every request. Examiners see clients they registered or that were shared with them, and only their own screenings, cases, search results and activity. Clients see only their own record. Admins see everything. |
| Evaluation respondents use test accounts and samples prepared by the researchers | EVAL-xx accounts are flagged as test accounts. The researchers register prepared test clients and share them with all test accounts (read-only: respondents screen against them but cannot add or remove references, and do not see each other's screenings). Clients a test account registers are always practice clients. Registering a client requires confirming the samples are prepared or made-up, not a legal signature. |
| No function to download or export signature images | There is none. Images are served only to signed-in users allowed to see them, marked inline and `no-store`, with right-click and drag disabled in the viewer. A test checks that no export or download endpoint exists. (Screenshots cannot be prevented by any web app; the research-use terms ask users not to copy signatures.) |
| Used only for the approved research activities, not for actual legal, financial or official documents | With `STUDY_MODE=true`, every user accepts the research-use terms before anything else is available (logged in the audit log), and the sidebar, Help Center and client forms say so. |

Supabase: run `supabase/rls.sql`, which turns on Row Level Security for every table, so nothing is readable through Supabase's public REST API; the backend applies the per-account rules above. In study mode, admins can see the status of all six points on **Policy and retention > Access control and ethical use**.

## Study mode

`STUDY_MODE` in `backend/.env` (default `false`). Set it to `true` for the study's evaluation sessions: users must accept the research-use terms, the research labels appear, and admins see the evaluation-account tools and the access-control checklist. With `false` ForgeBlock looks and works like a normal product.

## Sign in with Microsoft or Google (Clerk)

ForgeBlock stays invite-only: Microsoft or Google sign-in only works for an email an administrator already registered. Clerk does the Google/Microsoft sign-in; the backend verifies Clerk's session token (RS256, issuer, expiry, authorized party), reads the verified email from Clerk's Backend API, and issues its own ForgeBlock session. Supabase stays the database.

1. Create a free account at clerk.com and an application (e.g. ForgeBlock). Under sign-in options keep **Email** and turn on **Google** and **Microsoft**. In development mode Clerk uses its own shared Google/Microsoft credentials, so no Google Cloud or Azure setup is needed.
2. Clerk dashboard → **Configure → API keys**: copy the **Publishable key** (`pk_test_...`) and **Secret key** (`sk_test_...`) into `backend/.env` as `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Optional `OAUTH_PROVIDERS=google` to show only one button.
3. `pip install cryptography` (or `pip install -r requirements.txt`) and restart the backend. The buttons appear on the sign-in page.

For a production Clerk instance, Clerk asks for your own Google/Microsoft credentials (its docs walk through it). Never put the secret key in the frontend or in Git.

## Upgrading from v4/v5/v6/v7

v8: extract `forgeblock-v8-update.zip` over your folder (see `UPDATE_V8.md`). No new packages; the database gets the new group columns by itself. Existing clients start ungrouped; create groups under **Clients** and move them in.


Copy the changed files over your existing folder (the v7 update zip). No new packages are needed, and the database is upgraded automatically on the next start: new columns are added, open "second opinion" cases go back to "Needs decision", and the ledger stays valid. Old Inconclusive/Inconsistent screenings made before v7 show "No case" in Records; open a case for them by hand if needed.

## Project layout

```
backend/                   FastAPI app
  app/main.py              app setup, admin seeding, daily jobs (ledger auto-check, retention)
  app/models.py            users, clients, signature_profiles, cases, case_events, verification_logs,
                           findings, blockchain_ledger, reports, activity_logs, notifications, settings
  app/ledger.py            SHA-256 hash-linked ledger (screening and finding blocks, validate, auto-check)
  app/services.py          storage, settings, codes, record_verification, notifications
  app/security.py          JWT, idle timeout, lockout, role checks
  app/ml/preprocessing.py  static preprocessing (Chapter 3, Algorithm 2)
  app/ml/decision.py       metrics, thresholds, voting, confidence
  app/ml/screening.py      screening labels, captions
  app/ml/features.py       feature analysis (static and dynamic)
  app/ml/quality.py        quality checks
  app/ml/explain.py        difference overlay
  app/ml/dynamic_model.py  dynamic model plug-in point
  app/ml/svc_dynamic/      the dynamic notebook's preprocessing + network (copied unchanged)
  app/routers/             auth, clients, cases, verification, records, admin
  seed.py                  demo data and evaluation accounts
  weights/                 model files + threshold configs
  tests/                   API tests (pytest)
frontend/                  React + Vite + Tailwind CSS (blue workspace UI)
collector/                 data collection tool (researchers only, separate app)
training/                  CEDAR evaluation, SVC2004 dynamic training
supabase/rls.sql           locks the tables against Supabase's public REST API
docs/paper-notes.md        points to align in Chapters 3 and 4
```

## Running it locally (Windows, macOS or Linux)

You need **Python 3.11 or 3.12** and **Node.js 20+**.

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS / Linux:       source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env      # macOS/Linux: cp .env.example .env   (then set JWT_SECRET and ADMIN_PASSWORD)
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs. Health and model status: http://localhost:8000/api/health

By default the database is SQLite (`backend/forgeblock.db`) and signature files go to `backend/storage/`. Both are ignored by git.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in as the seeded administrator (`admin@forgeblock.local` and `ADMIN_PASSWORD` from `.env`, default `ChangeMe123!`). You will be asked to choose a new password.

### 3. Demo data (optional)

On an **empty** database, after the admin has changed their password:

```bash
cd backend
python seed.py demo --admin-password <new admin password>
```

This adds two examiners, a client account, clients with computer-drawn signatures, cases, screenings and findings. All demo accounts use the password `Demo-pass-2026`. The demo signatures are drawn with script fonts, so the model's scores on them are only illustrative.

### 4. Evaluation accounts

```bash
python seed.py eval --admin-password <admin password> --accounts 50 [--samples DIR] --out eval_accounts.csv
```

Creates EVAL-01 … EVAL-50 test examiner accounts with temporary passwords in `eval_accounts.csv` (keep it with the researchers; do not commit it). With `--samples DIR`, test clients are registered from `DIR/<Client code>/references/*.png` and shared (read-only) with every test account; use codes or made-up names for the folders. Each respondent sees only their own screenings. You can also share a client from its page (admin: **Shared with > Share with all test accounts**).

### 5. iPad

The dev server listens on your network. With the laptop and iPad on the same Wi-Fi, open `http://<laptop-ip>:5173` in Safari on the iPad.

### 6. Wacom One CTL-472 (development only)

Until the Apple Pencil arrives, a Wacom One CTL-472 (or another USB pen tablet without tilt) can be used to try the dynamic module:

1. Install the Wacom driver and, in **Wacom Tablet Properties > Mapping**, turn **Use Windows Ink** on (otherwise the browser sees a mouse). On a Mac, the driver works as is.
2. Set `DEV_PEN_DEVICES=true` in `backend/.env` and restart the backend.
3. Use Chrome or Edge on the laptop. Turn on **Pen-only mode** on the signing pad.

What changes in this mode: the dynamic model was trained with pen angles, which the CTL-472 does not measure, so the angle features are set to their training average and results are **less accurate**. These signatures and screenings are marked **Development device**, are compared only with development-device references (never mixed with Apple Pencil ones), and are left out of the model performance figures. A notice is shown on every signing pad while the mode is on. Set it back to `false` (and use the Apple Pencil) for the study's data gathering and evaluation. Chapter 1.7 and 3.7.1 and the consent form name the iPad and Apple Pencil.

### Tests

```bash
cd backend && pytest -q
cd collector && pytest -q
```

## Data collection tool (`collector/`)

One session of about 15 minutes per participant: 20 genuine signatures on paper, 20 genuine on the iPad, 20 paper forgeries of an automatically assigned target, a tracing practice over the target's signature (not saved), then 10 iPad forgeries.

```bash
cd collector
COLLECTOR_KEY=choose-a-passphrase uvicorn app:app --host 0.0.0.0 --port 8100
# Windows PowerShell:  $env:COLLECTOR_KEY="choose-a-passphrase"; uvicorn app:app --host 0.0.0.0 --port 8100
```

Open `http://<laptop-ip>:8100` on the iPad. It uses the backend's Python environment.

- **Sessions**: participant code (P001…), consent confirmation, automatic forgery target (the earliest participant with all 20 iPad genuine signatures and no forger yet; the first participant has none and can be assigned one later). Withdrawing a participant deletes all their data.
- **iPad capture** writes SVC2004 files `collector/data/dynamic/U{user}S{n}.TXT`: first line the number of points, then `X Y TIME PEN AZIMUTH ALTITUDE PRESSURE` per point. S1–S20 are genuine; S21–S30 are forgeries of that user made by another participant. Hover points between strokes are recorded with PEN 0. AZIMUTH is written clockwise from 12 o'clock like SVC2004 (Pointer Events measure it from 3 o'clock).
- **Printable sheet**: short bond, landscape, 4 × 5 boxes with corner marks. Print at actual size. `python sheets.py template --out sheet.pdf` also works offline.
- **Sheet import**: upload a scan or a flat phone photo; the corner marks straighten it, the 20 boxes are cropped, empty boxes are flagged, and the researcher checks the crops before they are saved as `static/P001/genuine/P001_G01.png` or `static/P001/forged/P001_F01_by_P002.png`.
- **Dataset export**: one zip with `dynamic/`, `static/`, `manifest.csv` and a format note, for the secured research device only.
- **Remote links** (for online, self-paced sessions): a session page can create a personal link `/p/#<token>` (1 to 14 days). The participant uses it on their own iPad with an Apple Pencil (finger input refused) without the researcher key; sheet photos they upload wait under Sheet import > Waiting for review. Finishing or revoking ends the link.

`collector/data/` holds personal research data and is ignored by git.

To host it online for remote sessions for free (Render + a private Supabase Storage bucket via `render.yaml`; or any Docker host with a `/data` volume), see [collector/DEPLOY_ONLINE.md](collector/DEPLOY_ONLINE.md).

## Using Supabase instead of SQLite

1. In Supabase, open **Project Settings → Database → Connection string**, choose the **Session pooler** URI, and put it in `backend/.env` as `DATABASE_URL=postgresql://...`.
2. Start the backend once; it creates the tables.
3. Run `supabase/rls.sql` in the Supabase SQL editor so the tables cannot be read through Supabase's public API.

Signature files stay on the backend server in `backend/storage/`.

## Models

### Static (in use)

`backend/weights/static_model.keras` is the team's trained embedding network (MobileNetV2 → Dense 512 → Dense 256 → L2 normalization, input 224×224×3 scaled to [−1, 1]). Default thresholds in `backend/weights/static_config.json`:

| Metric | Threshold |
| --- | --- |
| Cosine similarity | ≥ 0.8925 |
| Euclidean distance | ≤ 0.4067 |
| Manhattan distance | ≤ 5.2698 |

With 5 or more references, personal thresholds are used: τ = clip(mean ± 1.5·sd) over the client's own references.

To measure performance on CEDAR writers that were **not** used in training:

```bash
python training/evaluate_static.py --cedar path/to/CEDAR --writers 46-55
# also prints the error-reject table and a suggested INCONCLUSIVE_BELOW
# (options --max-error 0.05 --max-inconclusive 0.25)
```

### Dynamic (team SVC2004 model)

`backend/weights/dynamic_encoder.pt` is the team's E2 model from the SVC2004 notebook (`svc_dynamic_colab.ipynb`, Task 2, base + pen angle + pressure features; 5-fold cross-validated enrollment EER 10.7% ± 3.8%, see `backend/weights/dynamic_model_card.json`). `backend/app/ml/svc_dynamic/` holds the notebook's preprocessing and network code, copied unchanged, so inference matches training. It needs **Apple Pencil** input: mouse or finger signatures are rejected with a message, because the model uses pen pressure and angle.

To replace it, export a new bundle from the notebook (cell C810) and upload the zip on **Admin → Model**; the file is test-loaded before it replaces the current one. Restart the backend, then use **Re-embed references**. Default thresholds come from the checkpoint (the validation EER threshold, converted to cosine); a `backend/weights/dynamic_config.json` overrides them. `load_dynamic_model()` in `backend/app/ml/dynamic_model.py` also accepts a state dict for the reference encoder trained with `python training/train_dynamic.py --svc path/to/SVC2004/Task2`, and runs an untrained placeholder when no file is present. The contract is `embed(points) -> L2-normalized vector`, `trained`, `kind` and `source`; `points` is an `(N, 7)` array of `x, y, t (ms), pen state, azimuth, altitude (degrees), pressure (0-1)`.

## How the ledger works

1. **Create**: each screening (and each examiner finding) is serialized and hashed with SHA-256 → `record_hash`.
2. **Store**: a new block stores `record_hash`, the previous block's `block_hash` and a timestamp; `block_hash = SHA-256(index | record_hash | previous_hash | timestamp)`. Block 0 is the genesis block.
3. **Check**: validation recomputes every record hash from the current database row and every block hash, and checks every link. It runs daily on its own and on demand. A changed result, score or block is reported with the first affected block. Receipt codes let anyone confirm a single record.

This is a hash-linked ledger stored in the application database, not a distributed blockchain network. Deleting a client's signature data keeps the ledger valid: blocks hold hashes and scores, not images.
