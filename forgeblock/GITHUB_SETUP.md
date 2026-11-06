# Putting ForgeBlock on GitHub

Push **code only**. Secrets (`.env`, keys, evaluation passwords) and any real
signatures (`collector/data/`, `backend/storage/`, databases, dataset zips)
stay on your computer. The `.gitignore` in this folder already blocks them.

## What goes in the repository

| Included | Kept out by `.gitignore` |
|---|---|
| `backend/` code, `requirements.txt`, `.env.example`, `seed.py`, tests | `backend/.env` (JWT secret, admin password, Supabase DB URL) |
| `backend/weights/` (static and dynamic models, about 14 MB) | `backend/storage/`, `*.db` (uploaded signatures, local database) |
| `frontend/` source, `package.json`, `package-lock.json` | `node_modules/`, `dist/`, `frontend/.env*` |
| `collector/` code, `Dockerfile`, `requirements.txt`, guides | `collector/data/` (all participant signatures and photos) |
| `render.yaml`, `supabase/`, `docs/`, `training/` code, `README.md` | `forgeblock-dataset-*.zip`, `training/results/`, `eval_accounts*.csv` |
| `.gitignore`, `.gitattributes` | `.venv/`, `__pycache__/`, editor and OS files |

## 1. Create the repository on GitHub (2 minutes)

1. Go to github.com/new.
2. Name: `forgeblock` (any name works).
3. Visibility: **Private**. The thesis code and trained models should not be
   public before your defense.
4. Leave **Add a README**, **.gitignore** and **license** all **off**
   (the project already has them; adding them here causes a merge step).
5. Click **Create repository** and keep the page open; it shows your
   repository URL, like `https://github.com/<your-username>/forgeblock.git`.

## 2. Push from your computer (PowerShell)

Check Git is installed: `git --version`. If not, install "Git for Windows"
(git-scm.com) and reopen PowerShell.

Use a **fresh folder from `forgeblock-v6.zip`** (not your older v4 folder, so
no old local data comes along by accident). If you want your settings, copy
your `backend\.env` into it; it is ignored and will not be pushed.

```powershell
cd path\to\forgeblock          # the folder with backend, frontend, collector

# first time on this computer only
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"

git init -b main
git add .
git status                     # read the list before committing (see the check below)
git commit -m "ForgeBlock v6"
git remote add origin https://github.com/<your-username>/forgeblock.git
git push -u origin main        # a GitHub sign-in window opens the first time
```

### Safety check before `git commit`

This must print nothing:

```powershell
git ls-files | Select-String -Pattern '\.env$','/data/','storage/','\.db$','dataset-'
```

If it prints a file, run `git rm --cached <file>` and check `.gitignore`.
If a secret was ever pushed, change that password or key right away; deleting
the file later does not remove it from GitHub's history.

## 3. Later changes

```powershell
git add .
git commit -m "Describe the change"
git push
```

Render redeploys the collector automatically after each push.

## 4. Connect it to Render

In Render: **New > Blueprint**, connect your GitHub account, allow access to
the `forgeblock` repository, and pick it. Then follow
`collector/DEPLOY_ONLINE.md`, step 3.
