# Updating to v8 (no reinstall)

Works on the folder you already updated to v7 (your `forgeblock-v4` folder).

1. Stop both terminals (Ctrl+C in the backend and the frontend).
2. Right-click `forgeblock-v8-update.zip` > **Extract All...** and set the destination to your
   `forgeblock-v4` folder (the folder that contains `forgeblock`). Choose **Replace the files in the destination**.
3. Optional clean-up: from `forgeblock-v4\forgeblock` in PowerShell run
   `powershell -ExecutionPolicy Bypass -File .\remove-old-v4-files.ps1`
   (or just delete `frontend\src\pages\admin\Performance.jsx` by hand; it is no longer used).
4. Start both again:
   - Command Prompt, in `backend`: `.venv\Scripts\activate.bat` then `uvicorn app.main:app --reload --port 8000`
   - Second Command Prompt, in `frontend`: `npm run dev`
5. Open http://localhost:5173 and sign in as admin.
6. Go to **Clients**, click **New group**, name it (e.g. Lawyers), pick its examiner. Then right-click
   a client in **Without a group** > **Move to group**.

Nothing to install. Your database gets the new columns by itself; existing clients start in **Without a group**.

Optional in `backend\.env`: `INCONCLUSIVE_BELOW=20` (the hidden Inconclusive cut-off; 20 is used if missing).
