# Putting the data collection tool online (free)

This is for remote, self-paced sessions: you create a personal link for each
participant, they do the session on their own iPad with an Apple Pencil, and
you review their paper-sheet photos before anything enters the dataset.

The tool still runs locally exactly as before
(`$env:COLLECTOR_KEY="..."; uvicorn app:app --host 0.0.0.0 --port 8100`).
Nothing below is needed for local use.

## How the free setup works

- **Render (free web service)** runs the tool and gives it an `https://` address.
  Its disk is wiped whenever the service sleeps (after 15 idle minutes) or
  redeploys.
- **Supabase Storage (free)** keeps the real copy in a **private bucket**. After
  every change the tool uploads the new files; when Render wakes up it
  downloads everything again before serving anyone. If Supabase cannot be
  reached at startup, the tool refuses to start rather than run on an empty
  copy.

Free-tier limits to know (check the current pages, they change):
- Render free sleeps after 15 minutes without visits; the next visit takes
  about a minute to load. Tell participants to wait if the page is slow at
  first.
- Supabase free gives 1 GB of storage (the whole study is well under that)
  and **pauses a project after about a week with no activity**. If it pauses,
  restore it from the Supabase dashboard before sending new links.

Why not Vercel or Netlify: they cannot keep files between visits, Vercel limits
uploads to 4.5 MB (iPad photos are often bigger), and Netlify cannot run this
Python server.

## 1. Supabase (10 minutes)

1. At supabase.com, create a **new project** just for data collection (for
   example `forgeblock-collector`), region **Southeast Asia (Singapore)**.
   Keeping it separate from the ForgeBlock app's project keeps the study data
   apart.
2. In **Project Settings > API Keys**, copy:
   - the **Project URL** (`https://xxxx.supabase.co`), and
   - a **secret key** (`sb_secret_...`; the legacy `service_role` key also
     works). This key has full access: keep it out of files, chats and GitHub.
3. You do not need to create the bucket: the tool creates a private bucket
   named `collector-data` on first start.

## 2. GitHub

Render deploys from a GitHub repository. Push the ForgeBlock project to a
**private** repository (`collector/data/` is already ignored by git, so no
signatures are pushed). `render.yaml` at the project root describes the
service.

## 3. Render (10 minutes)

1. Sign up at render.com with GitHub and allow access to the repository.
2. **New > Blueprint**, pick the repository. Render reads `render.yaml` and
   asks for three values:
   - `COLLECTOR_KEY`: a long random passphrase (4+ random words or 16+
     characters). This is the researcher key.
   - `SUPABASE_URL`: the Project URL from step 1.
   - `SUPABASE_SECRET_KEY`: the secret key from step 1.
3. Apply. The first build takes a few minutes. Your address looks like
   `https://forgeblock-collector.onrender.com`.
4. Check the **Logs**: you should see `Restored 0 files from Supabase Storage
   bucket 'collector-data'`. Open the address and enter the researcher key.

Updating the code later: push to GitHub and Render redeploys by itself. The
data stays in Supabase.

## 4. Each participant

1. Get the signed consent form first. Then, in Sessions, create the
   participant's code and tick *Signed consent form received*.
2. Open the session and click **Create link** in *Remote link* (3 days by
   default, up to 14). Copy it and send it **privately** to that participant
   only. It is shown once; if it is lost, click *New link* (the old one stops
   working).
3. The participant works through: paper sheet (print, sign 20 boxes,
   photograph, upload), 20 iPad signatures, and, if they have a forgery
   target, the imitation sheet, tracing practice and 10 iPad imitations.
   Finger input is refused. They can stop and continue later with the same
   link until it expires.
4. Photos land in **Sheet import > Waiting for review**. Check the crops and
   save, or discard and ask for a better photo.
5. When the participant taps **Finish**, their link stops working. You can
   revoke a link at any time from the session page.

Participants without a printer: print both sheets yourself (Print genuine
sheet / Print forgery sheet on the session page) and give or mail them.

## 5. Keeping the data safe

- All traffic is HTTPS. The link's secret sits after `#`, so it never appears
  in server logs. A participant link can only add that participant's own
  data; it cannot see other participants, notes or the export.
- The bucket is private: only the secret key (on Render) and your Supabase
  login can read it.
- Ten wrong researcher keys from one address lock that address out for 15
  minutes. Still use a long key.
- **Export the dataset regularly** (Dataset > Export) to your encrypted
  research drive.
- When collection ends: export one last time, then delete the bucket (or the
  whole Supabase project) and the Render service, so no signatures remain
  online.

## 6. Ethics form changes to make

Remote collection changes what you promised participants, so update the
consent form and ethics application before using it:

- Data is sent over the internet (HTTPS) and stored temporarily in a private
  cloud storage bucket (Supabase, Singapore region; the app itself runs on
  Render), then moved to the research device and deleted from the cloud at the
  end of collection.
- Sessions are done on the participant's own iPad and Apple Pencil, without a
  researcher present.
- For the imitation task, another participant's signature is shown on the
  participant's own screen without supervision. Ask them not to save, copy or
  share it.
- How to withdraw: contact the researcher, who deletes all their data
  (Finish step > *Participant withdrew* also removes it from the cloud copy).

## Paid alternative

If the one-minute wake-up delay or the Supabase pause becomes a problem, the
same `Dockerfile` runs on an always-on host with a persistent disk (for
example Railway, about USD 5/month): mount a volume at `/data`, set
`COLLECTOR_KEY`, and leave the Supabase variables out.
