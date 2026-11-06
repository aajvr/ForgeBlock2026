# Updating your v4 folder to v7 (no reinstall)

1. Stop both terminals (Ctrl+C in the backend and the frontend).
2. Right-click `forgeblock-v7-update-for-v4.zip` > **Extract All...** and set the destination to your
   `forgeblock-v4` folder (the folder that contains `forgeblock`). Choose **Replace the files in the destination**.
3. Optional clean-up: in PowerShell, from `forgeblock-v4\forgeblock`, run
   `powershell -ExecutionPolicy Bypass -File .\remove-old-v4-files.ps1`
   (removes 6 old pages that v7 no longer uses; they are harmless if left).
4. Start both again, the same way as before:
   - `backend`: `.venv\Scripts\Activate.ps1` then `uvicorn app.main:app --reload --port 8000`
   - `frontend`: `npm run dev`
5. Open http://localhost:5173 (the new landing page). Sign in from there.

Nothing to install: no new Python or npm packages. Your `.venv`, `node_modules`, `backend\.env` and
database are kept, and the database is upgraded by itself on start.

Optional settings in `backend\.env` (copy the lines from `.env.example`):
- `STUDY_MODE=true` for the study's evaluation sessions (research-use terms and labels). Default is off.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` to turn on the Microsoft and Google buttons (see README,
  "Sign in with Microsoft or Google").
