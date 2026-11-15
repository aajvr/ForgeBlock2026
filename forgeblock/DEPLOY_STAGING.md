# Deploy a ForgeBlock staging copy (free)

Backend (FastAPI + models) -> Hugging Face Space (Docker, free CPU, 16 GB RAM)
Frontend (React)           -> Vercel (free)
Database + images          -> Supabase (Postgres + private Storage bucket, already supported since v8.24)

Every push to `main` redeploys both. Work on a branch, merge to `main` when it is ready.

Why not Render free: with both models and the text remover loaded, the backend uses
about 1.4 GB of RAM (measured). Render free gives 512 MB.

## 0. Add the files from this zip
Extract over the repo root (the folder that contains `forgeblock/`):
- `.github/workflows/deploy-backend-hf.yml`  (copies the backend to the Space on push)
- `forgeblock/backend/Dockerfile`, `forgeblock/backend/.dockerignore`
- `forgeblock/frontend/vercel.json`          (page refresh on /app/... works)
Commit and push to `main` AFTER steps 1-2, or the first run fails (it needs the token).

## 1. Supabase (staging)
Recommended: a NEW free Supabase project just for staging, so participants' test data
never mixes with your local database. (If you already have 2 free projects, reuse yours.)
- Connect > Session pooler > copy the URI  -> DATABASE_URL
- Project Settings > API: Project URL -> SUPABASE_URL, secret / service_role key -> SUPABASE_SERVICE_KEY
- The backend creates the tables and the private bucket itself. Then run supabase/rls.sql in the SQL editor.

## 2. Hugging Face Space (backend)
1. huggingface.co > New Space: name `forgeblock-api`, SDK **Docker** (Blank), hardware **CPU basic (free)**,
   visibility **Public** (a private Space cannot be called by the website; your secrets stay hidden either way).
2. Space > Settings > **Variables and secrets** > add as **Secrets**:
   - DATABASE_URL, JWT_SECRET (new long random string), ADMIN_EMAIL, ADMIN_PASSWORD (strong!), ADMIN_NAME
   - SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET=forgeblock-samples
   - CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY (optional; leave out to show only email + password)
   and as **Variables**:
   - CORS_ORIGINS = your Vercel URL from step 3, e.g. https://forgeblock.vercel.app (no trailing slash)
   - STUDY_MODE=true, DEMO_MODE=true (defense demo), DEV_PEN_DEVICES=false
   - MIN_ADAPTIVE_SAMPLES=7, RECOMMENDED_REFERENCES=20, MAX_REFERENCES=30, TEXT_REMOVAL=true, CLIENT_FULL_RESULTS=true
   - RESEARCH_TEAM_EMAILS = the team's emails, comma-separated
3. huggingface.co > Settings > Access Tokens > New token, type **Write**. Copy it.
4. GitHub repo > Settings > Secrets and variables > Actions:
   - Secrets tab: `HF_TOKEN` = that token
   - Variables tab: `HF_SPACE` = `<your-hf-username>/forgeblock-api`
5. Push the files from step 0 to `main` (or Actions > Deploy backend to Hugging Face > Run workflow).
   The Space builds for ~5-10 minutes the first time. Check: https://<user>-forgeblock-api.hf.space/api/health

## 3. Vercel (frontend)
1. vercel.com > sign in with GitHub > Add New Project > pick ForgeBlock2026.
2. **Root Directory: `forgeblock/frontend`**. Framework: Vite (auto).
3. Environment Variables: `VITE_API_URL` = `https://<user>-forgeblock-api.hf.space` (no trailing slash).
4. Deploy. Put the Vercel URL into the Space's CORS_ORIGINS (step 2.2) and restart the Space.

## 4. After the first deploy
- Sign in with ADMIN_EMAIL / ADMIN_PASSWORD, create the EVAL-01 ... test examiner accounts and the
  practice clients, then share the clients with all test accounts.
- Clerk (Google/Microsoft): add the Vercel URL in the Clerk dashboard (allowed origins / domains).
  If that sign-in misbehaves on the deployed site, participants can still use email + password.

## Good to know
- The Space sleeps after ~48 h without visits; the first visit wakes it (about 1 minute).
- Changing a Space variable/secret needs a Space restart (Settings > Restart).
- A dynamic model uploaded from the System page lives only until the next deploy. Put model files in
  `backend/weights` in Git instead.
- Your GitHub repo is PUBLIC (code + model weights visible to anyone). No secrets or signatures are in
  it (checked), but you can make it private; the deploy still works.
- Real signatures only after ethics clearance, and the consent form must name Supabase / Hugging Face /
  Vercel and the data region.
