# ForgeBlock v8.24 update: shared images + full client results

Built on GitHub main (commit 08b7d60, v8.23). Backend tests: 102 passed.

## What changes

1. **Images are shared between computers (Supabase Storage).**
   Every new reference image, questioned image and stroke file is also uploaded to a
   private Supabase Storage bucket. When a PC opens a record whose file it does not have,
   it downloads it from the bucket (and keeps a copy in `backend/storage`). So a signature
   uploaded on Aa's PC now shows on Miel's PC and the other way around.
   Deleting a reference / client also deletes the shared copy.
   Without the keys in `.env`, nothing changes (files stay local, like before).
2. **Clients see their full result**, read-only: confidence score with the plain reason,
   the Scores tab, Handwriting features, their questioned signature beside the closest
   reference, Feature marks (static) or Stroke replay (dynamic), and the ledger proof.
   Still hidden from clients: the examiner's private notes, links to cases, and other
   clients' data (the backend still checks every record belongs to that client).
   To go back to the old limited view: `CLIENT_FULL_RESULTS=false` in `backend/.env`.

## Install (do this on EVERY computer)

1. Stop the backend. Extract the zip **over** the `forgeblock-v4` folder (replace files).
   Only 2 frontend files change (`frontend/src/components/ResultView.jsx`,
   `frontend/src/pages/Record.jsx`). If you edited those in VS Code and did not push,
   apply `forgeblock-v8.24.patch` instead (`git apply forgeblock-v8.24.patch`), or
   just pull from GitHub after one PC pushes.
2. `pip install httpx` (inside the venv: `.venv\Scripts\activate.bat` first).
3. Add to `backend/.env` (same values on every PC):
   ```
   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_SERVICE_KEY=your service_role key (or sb_secret_... key)
   SUPABASE_BUCKET=forgeblock-samples
   ```
   Where: Supabase dashboard > your project > Project Settings > API (Project URL,
   and the `service_role` secret key / "Secret keys"). Never put this key in the frontend.
4. Start the backend. The console should say
   `Shared storage (Supabase Storage, bucket 'forgeblock-samples'): ON`.
   The bucket is created automatically as **private**.
5. **Copy the old images up (once per PC):**
   ```
   cd backend
   python -m app.sync_storage
   ```
   It uploads everything in this PC's `backend/storage` and skips files already in the
   bucket. Run it on Aa's PC AND on Miel's PC, so images from both end up shared.
6. Check: open a record made on the other PC. The images should now show.

## Notes for the paper (Ch3 3.8 / Ch4)
- Storage: "signature samples are stored in a private Supabase Storage bucket; the files
  are reached only through the backend's view-only endpoints (no public links, no download
  or export)". Supabase is now the database AND the file storage.
- Access: "clients can view the full screening result of their own records in read-only
  form; the examiner's notes and case handling remain staff-only".

## Files
backend/app/remote_storage.py (new), backend/app/sync_storage.py (new),
backend/app/services.py, config.py, main.py, security.py,
backend/app/routers/verification.py, clients.py, admin.py,
backend/requirements.txt, backend/.env.example,
backend/tests/test_shared_storage.py (new), test_api.py, test_overlay_views.py, test_v8.py,
frontend/src/components/ResultView.jsx, frontend/src/pages/Record.jsx
