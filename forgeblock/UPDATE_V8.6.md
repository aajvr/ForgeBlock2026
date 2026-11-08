# ForgeBlock v8.6 - enrollment sheet + phone scan (static references)

Built on your forgeblock-current.zip (v8.5 + your redesign). Only these files change:
- NEW  backend/app/ml/enroll_sheet.py          printable 10-box sheet (PDF) + photo import (straighten, crop, clean)
- EDIT backend/app/routers/clients.py          2 new endpoints: GET .../static/enrollment-sheet, POST .../static/sheet-preview
- NEW  backend/tests/test_v86.py               3 tests
- NEW  frontend/src/components/SheetEnroll.jsx  Print sheet / Scan with phone / Upload a scan + preview grid
- EDIT frontend/src/pages/Clients.jsx          Static tab gets a switch: "Enrollment sheet (phone)" | "Upload signature images"
- EDIT CLAUDE.md                               notes for Claude Code (calibrated confidence + enrollment sheet)
No new Python or npm packages. No database change.

Apply (same as v8.5):
  git checkout -b enrollment-sheet
  (extract this zip into forgeblock-v4\forgeblock, replace files)
  git status        -> the 6 files above
  restart backend and frontend, test, then:
  git add -A && git commit -m "v8.6: enrollment sheet + phone scan"
  git checkout main && git merge enrollment-sheet

How it works
1. Client card > Static tab > "Enrollment sheet (phone)" > Print sheet (short bond / letter, portrait,
   10 boxes, client code only, four black corner squares).
2. The client signs once in each box.
3. "Scan with phone" opens the camera (on a phone/tablet) or "Upload a scan" picks a file.
   The photo can be tilted, sideways or upside down; the corner squares straighten it.
4. ForgeBlock shows the 10 cleaned crops; untick bad/empty boxes; "Add N references".
   Nothing is stored until you press Add; the crops then go through the normal quality check.

Using a real phone: either open ForgeBlock on the phone (run the frontend with
`npm run dev -- --host`, then open http://<laptop-IP>:5173 on the phone, same Wi-Fi),
or take the photo with the phone camera, send it to the laptop, and use "Upload a scan".

Note: the old 20-box research sheets (collector) have a different layout; this importer reads only
the new 10-box enrollment sheet.
