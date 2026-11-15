# Deploy a ForgeBlock staging copy (student budget)

Backend (FastAPI + models) -> Azure Web App for Containers, Basic B1 (1.75 GB RAM), paid from the
                              free Azure for Students credit (US$100/year, no credit card)
Backend image              -> built by GitHub Actions, stored free in GitHub Container Registry (ghcr.io)
Frontend (React)           -> Vercel (free)
Database + images          -> Supabase (Postgres + private Storage bucket, supported since v8.24)

Every push to `main` that changes `forgeblock/backend/` rebuilds the image and tells Azure to restart
with it; Vercel rebuilds the website on every push. Work on a branch, merge to `main` when ready.

Why not a free host: with both models and the text remover loaded the backend uses about 1.4 GB
of RAM (measured). Render/Koyeb free give 512 MB; Hugging Face made Docker Spaces PRO-only (July 2026).

## A. Supabase (staging)  ~5 min
1. supabase.com/dashboard > New project `forgeblock-staging`, region Southeast Asia (Singapore), set a DB password.
   (Free plan full? Reuse your current project instead.)
2. Connect > Session pooler > copy the URI, put your password in place of [YOUR-PASSWORD] -> DATABASE_URL
3. Project Settings > API Keys: Project URL -> SUPABASE_URL; secret key (sb_secret_...) or service_role -> SUPABASE_SERVICE_KEY
4. JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(48))"

## B. GitHub: build the backend image  ~15 min (mostly waiting)
5. Merge the deployment pull request into `main`.
6. Actions tab > "Deploy backend" runs (first build ~10-15 min). It ends with
   "AZURE_WEBHOOK_URL not set yet; image published only." - that is expected for now.
7. Your GitHub profile > Packages > forgeblock-api > Package settings > Change visibility > Public.
   (The repo is already public, so the image adds nothing secret: no .env, no database, no signatures.)

## C. Azure for Students: run the backend  ~20 min
8. azure.microsoft.com/free/students > Start free > verify with your SCHOOL email. No card needed.
9. portal.azure.com > Create a resource > Web App:
   - Subscription: Azure for Students. Resource group: Create new `forgeblock`.
   - Name: `forgeblock-api` (Azure may add a suffix). Publish: **Container**. OS: **Linux**.
   - Region: Southeast Asia (if it is not allowed for your subscription, pick East Asia or any allowed one).
   - Pricing plan: Create new, then Explore pricing plans > **Basic B1**. Check the monthly estimate it shows.
   - Container tab: Image source **Other container registries**, Access **Public**,
     Registry server URL `https://ghcr.io`, Image and tag `aajvr/forgeblock-api:latest`.
   - Review + create > Create. Then Go to resource.
10. Settings > **Environment variables** > App settings > + Add (then Apply):
    - WEBSITES_PORT = 7860
    - WEBSITES_CONTAINER_START_TIME_LIMIT = 600   (the models take a while to load)
    - DATABASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY   (from part A)
    - SUPABASE_BUCKET = forgeblock-samples
    - ADMIN_EMAIL, ADMIN_PASSWORD (a STRONG new one), ADMIN_NAME
    - RESEARCH_TEAM_EMAILS = team emails, comma-separated
    - STUDY_MODE = true, DEMO_MODE = true, MIN_ADAPTIVE_SAMPLES = 7
    - CORS_ORIGINS = *   (replace with the Vercel URL in step 15)
    - CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY (optional, from your local backend/.env)
11. Settings > Configuration > General settings: **Always On = On** > Save. (Health check path: /api/health, optional.)
12. Deployment Center: Continuous deployment **On** > Save > copy the **Webhook URL**.
    GitHub repo > Settings > Secrets and variables > Actions > New repository secret
    `AZURE_WEBHOOK_URL` = that URL. From now on every backend push redeploys automatically.
13. Overview > Default domain, e.g. https://forgeblock-api-xxxx.southeastasia-01.azurewebsites.net
    Open <that>/api/health -> {"status":"ok",...}. The first start can take 3-5 minutes
    (Log stream shows progress).
14. Supabase > SQL Editor: paste forgeblock/supabase/rls.sql > Run (after the tables exist, i.e. after step 13).

## D. Vercel (website)  ~5 min
15. vercel.com > sign in with GitHub > Add New > Project > ForgeBlock2026.
    Root Directory `forgeblock/frontend`; Environment Variable `VITE_API_URL` = the Azure URL (no trailing /).
    Deploy. Then in Azure set CORS_ORIGINS = the Vercel URL (no trailing /) > Apply.
16. Clerk (Google/Microsoft): add the Vercel URL in the Clerk dashboard. Email + password always works.

## E. Test
17. Open the Vercel URL, sign in as ADMIN_EMAIL, create EVAL-01 + a practice client, enroll refs,
    screen one static and one dynamic (iPad) signature. Then create the other test accounts.

## Money (Azure for Students credit)
- B1 Linux is roughly US$13/month (check the estimate in step 9), so US$100 lasts ~7 months.
  The plan is billed while it exists, even if the app is stopped: DELETE the resource group
  `forgeblock` after the defense. Cost Management > Budgets: add a US$15/month alert.
- When the credit runs out, Azure disables the resources; it never charges you (no card on file).
- Out of memory (app restarts, "exit code 137" in Log stream)? Scale up to B2 (3.5 GB, ~2x price).

## Good to know
- A dynamic model uploaded from the System page lives only until the next deploy; put model files
  in backend/weights in Git instead.
- The GitHub repo and the image are PUBLIC (code + weights). No secrets/signatures are in them.
- Real signatures only after ethics clearance; the consent form must name Supabase, Microsoft Azure,
  Vercel and the data region.
