"""Seeding helper. Run from backend/ with the virtualenv active.

  python seed.py eval --accounts 50 [--samples DIR]
      Creates test examiner accounts EVAL-01..EVAL-50 for evaluation
      respondents and writes their temporary passwords to
      eval_accounts.csv (keep it with the researchers; do not commit it).
      With --samples, also registers test clients from prepared images and
      gives every test account access to them (read-only):
          DIR/<Client code>/references/*.png   -> reference signatures (10-20)
      Use codes or made-up names for the folders, never a real person's name.
      The prepared questioned samples (genuine/forged) stay in DIR for the
      respondents to upload during the evaluation.

  python seed.py demo
      Fills an EMPTY database with synthetic demo data (made-up names and
      computer-drawn signatures) so the system can be tried and screenshotted.
      Never use it on a database with real data.

Both go through the API in-process, so all normal rules (quality checks,
ledger, audit log) apply.
"""
import argparse
import csv
import os
import sys
from pathlib import Path

import cv2
import numpy as np


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _admin(c, email, password):
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        sys.exit(f"Admin sign-in failed: {r.json().get('detail')}")
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    if r.json()["user"]["must_change_password"]:
        sys.exit("Sign in to the web app once and change the admin's temporary password first.")
    c.post("/api/auth/research-use/accept", headers=h)
    return h


# ------------------------------------------------------- synthetic signatures ---

FONTS = [cv2.FONT_HERSHEY_SCRIPT_COMPLEX, cv2.FONT_HERSHEY_SCRIPT_SIMPLEX]


def synthetic_signature(name: str, seed: int, style: int = 0, forged: bool = False) -> np.ndarray:
    """Draws a made-up signature: the name in a script font with a flourish,
    small natural variation per seed. Forgeries use another hand (font,
    slant, proportions) and a slightly shaky line."""
    rng = np.random.default_rng(seed)
    W, H = 900, 300
    img = np.full((H, W, 3), 248, np.uint8)
    font = FONTS[(style + (1 if forged else 0)) % 2]
    scale = 2.6 + rng.normal(0, 0.06) + (0.35 if forged else 0)
    thick = int(3 + (1 if forged else 0) + rng.integers(0, 2))
    text = name if not forged else name.lower().title()
    (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
    x0 = int((W - tw) / 2 + rng.normal(0, 6))
    y0 = int(H / 2 + th / 2 + rng.normal(0, 4))
    cv2.putText(img, text, (x0, y0), font, scale, (35, 30, 30), thick, cv2.LINE_AA)
    # Flourish under the name.
    xs = np.linspace(x0 - 10, x0 + tw + 30, 120)
    amp = 10 + rng.normal(0, 1.5) + (8 if forged else 0)
    ys = y0 + 22 + amp * np.sin((xs - x0) / (55 + rng.normal(0, 2))) * np.exp(-(xs - x0) / (tw * 1.4))
    if forged:
        ys = ys + rng.normal(0, 1.4, ys.shape)
    cv2.polylines(img, [np.stack([xs, ys], 1).astype(np.int32)], False, (35, 30, 30), max(2, thick - 1), cv2.LINE_AA)
    # Slant, slight rotation and scale.
    shear = rng.normal(-0.18 if not forged else 0.05, 0.025)
    ang = rng.normal(0, 1.2)
    M = cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1 + rng.normal(0, 0.02))
    M[0, 1] += shear
    M[0, 2] -= shear * H / 2
    img = cv2.warpAffine(img, M, (W, H), borderValue=(248, 248, 248))
    # Paper texture and scan noise.
    noise = rng.normal(0, 3, img.shape)
    return np.clip(img.astype(np.float64) + noise, 0, 255).astype(np.uint8)


def synthetic_strokes(seed: int, forged: bool = False) -> list:
    """A made-up live signature: three strokes with time, pressure and pen angles.
    Forgeries are slower, with pauses and an extra pen lift."""
    rng = np.random.default_rng(1000 + (seed if not forged else seed + 77))
    base = np.random.default_rng(7)
    phases = base.uniform(0, 6, 3)
    out, t = [], 0.0
    n_strokes = 4 if forged else 3
    for s in range(n_strokes):
        stroke = []
        k = s % 3
        for i in range(70):
            dt = (14 if forged else 7) + rng.normal(0, 1.2)
            if forged and i in (25, 50):
                dt += 220
            t += max(2.0, dt)
            x = 110 * k + i * 2.4 + rng.normal(0, 0.9 if forged else 0.5) + (40 if s == 3 else 0)
            y = 90 + 40 * np.sin(i / (6.0 + 0.4 * k) + phases[k]) * (1.15 if forged else 1) + rng.normal(0, 0.5)
            p = 0.45 + 0.2 * np.sin(i / 9 + k) + (0.12 if forged else 0) + rng.normal(0, 0.02)
            az = (55 if forged else 40) + 6 * np.sin(i / 20 + k) + rng.normal(0, 1)
            alt = (62 if forged else 55) + 3 * np.cos(i / 15) + rng.normal(0, 0.5)
            stroke.append({"x": float(x), "y": float(y), "t": float(t), "pressure": float(np.clip(p, 0.05, 1)),
                           "tiltX": 0, "tiltY": 0, "azimuth": float(az), "altitude": float(alt)})
        out.append(stroke)
        t += 420 if forged else 140
    return out


def _png(img: np.ndarray) -> bytes:
    return cv2.imencode(".png", img)[1].tobytes()


# ------------------------------------------------------------------- demo ---

def seed_demo(admin_email: str, admin_password: str) -> None:
    c = _client()
    with c:
        if c.post("/api/auth/login", json={"email": admin_email, "password": admin_password}).status_code != 200:
            sys.exit("Admin sign-in failed.")
        h = _admin(c, admin_email, admin_password)
        if c.get("/api/clients", headers=h).json():
            sys.exit("The database already has clients. The demo seed only runs on an empty database.")

        def account(name, email, role, **extra):
            r = c.post("/api/admin/users", headers=h, json={"full_name": name, "email": email, "role": role, **extra})
            temp = r.json()["temporary_password"]
            t = c.post("/api/auth/login", json={"email": email, "password": temp}).json()["token"]
            hh = {"Authorization": f"Bearer {t}"}
            c.post("/api/auth/change-password", headers=hh, json={"current_password": temp, "new_password": "Demo-pass-2026"})
            c.post("/api/auth/research-use/accept", headers=hh)
            return hh

        ex1 = account("Maria Reyes", "maria.reyes@forgeblock.local", "examiner")
        ex2 = account("Paolo Santos", "paolo.santos@forgeblock.local", "examiner")
        ex3 = account("Lea Garcia", "lea.garcia@forgeblock.local", "examiner")
        # Client groups (folders), one examiner each.
        for gname, desc, hh in [("Lawyers", "Law office clients", ex1), ("OSS", "Office of Student Services", ex2),
                                ("CCJE", "College of Criminal Justice Education", ex3)]:
            uid = c.get("/api/auth/me", headers=hh).json()["id"]
            c.post("/api/groups", headers=h, json={"name": gname, "description": desc, "examiner_id": uid})

        # Made-up names, drawn in a script font. Real study data would use codes only.
        people = [("Juan Dela Cruz", 0, 12), ("Ana Villanueva", 1, 10), ("Carlo Mendoza", 0, 6)]
        ids = {}
        for i, (name, style, n) in enumerate(people):
            cid = c.post("/api/clients", headers=ex1, json={"full_name": name}).json()["id"]
            ids[name] = cid
            files = [("files", (f"ref{j}.png", _png(synthetic_signature(name, 100 * i + j, style)), "image/png"))
                     for j in range(n)]
            c.post(f"/api/clients/{cid}/static/enroll", headers=ex1, files=files)
            c.post(f"/api/clients/{cid}/dynamic/enroll", headers=ex1,
                   json={"samples": [synthetic_strokes(100 * i + j) for j in range(min(n, 10))]})
        practice = c.post("/api/clients", headers=ex2, json={"full_name": "Practice signer", "is_practice": True}).json()["id"]
        c.post(f"/api/clients/{practice}/dynamic/enroll", headers=ex2,
               json={"samples": [synthetic_strokes(900 + j) for j in range(5)]})
        rosa = c.post("/api/clients", headers=ex3, json={"full_name": "Rosa Lim"}).json()["id"]
        files = [("files", (f"ref{j}.png", _png(synthetic_signature("Rosa Lim", 700 + j, 1)), "image/png"))
                 for j in range(8)]
        c.post(f"/api/clients/{rosa}/static/enroll", headers=ex3, files=files)

        def case(hh, title, name, doc):
            return c.post("/api/cases", headers=hh, json={"title": title, "client_id": ids[name], "document_ref": doc}).json()["id"]

        def screen(hh, name, case_id, img, expected=None):
            data = {"client_id": str(ids[name])}
            if case_id:
                data["case_id"] = str(case_id)
            if expected:
                data["expected_label"] = expected
            return c.post("/api/screen/static", headers=hh, data=data, files={"file": ("q.png", _png(img), "image/png")}).json()

        # Case 1: prepared genuine sample, closed as Genuine.
        k1 = case(ex1, "Loan application form", "Juan Dela Cruz", "Q-01")
        screen(ex1, "Juan Dela Cruz", k1, synthetic_signature("Juan Dela Cruz", 51, 0), "genuine")
        c.post(f"/api/cases/{k1}/finding", headers=ex1, json={"finding": "genuine", "reason": "Letter forms, slant and the closing flourish match the references."})
        # Case 2: prepared forgery, closed as Forged.
        k2 = case(ex1, "Deed of sale, page 2", "Ana Villanueva", "Q-02")
        screen(ex1, "Ana Villanueva", k2, synthetic_signature("Ana Villanueva", 7, 1, forged=True), "forged")
        c.post(f"/api/cases/{k2}/finding", headers=ex1, json={"finding": "forged", "reason": "Different hand: upright slant, heavier strokes and a different flourish."})
        # Case 3: open, with screenings waiting for a finding.
        k3 = case(ex1, "Bank withdrawal slip", "Juan Dela Cruz", "Q-03")
        screen(ex1, "Juan Dela Cruz", k3, synthetic_signature("Juan Dela Cruz", 9, 0, forged=True), "forged")
        r = c.post("/api/screen/dynamic", headers=ex1, json={"test": synthetic_strokes(12, forged=True), "client_id": ids["Juan Dela Cruz"], "case_id": k3})
        k4 = case(ex1, "Employment contract", "Carlo Mendoza", "Q-04")
        screen(ex1, "Carlo Mendoza", k4, synthetic_signature("Carlo Mendoza", 77, 0), "genuine")
        # Evaluation-style labeled samples for the model performance page.
        for j in range(6):
            screen(ex1, "Juan Dela Cruz", None, synthetic_signature("Juan Dela Cruz", 300 + j, 0), "genuine")
            screen(ex1, "Juan Dela Cruz", None, synthetic_signature("Juan Dela Cruz", 400 + j, 0, forged=True), "forged")
            screen(ex1, "Ana Villanueva", None, synthetic_signature("Ana Villanueva", 500 + j, 1), "genuine")
            screen(ex1, "Ana Villanueva", None, synthetic_signature("Ana Villanueva", 600 + j, 1, forged=True), "forged")
        c.post("/api/screen/dynamic", headers=ex2, json={"test": synthetic_strokes(901), "client_id": practice})
        c.post("/api/admin/users/bulk", headers=h, json={"prefix": "EVAL", "start": 1, "count": 3})
        # Examiners see only clients they registered; share one with the test accounts.
        c.put(f"/api/admin/clients/{ids['Ana Villanueva']}/access", headers=h, json={"all_test_accounts": True})
        account("Juan Dela Cruz", "juan@client.local", "client", client_id=ids["Juan Dela Cruz"])
        print("Demo data created. Examiners: maria.reyes@forgeblock.local (Lawyers), paolo.santos@forgeblock.local "
              "(OSS), lea.garcia@forgeblock.local (CCJE); client: juan@client.local; all with password "
              "Demo-pass-2026.", r.status_code)


# ------------------------------------------------------------------- eval ---

def seed_eval(admin_email: str, admin_password: str, accounts: int, samples: Path | None, out: Path) -> None:
    c = _client()
    with c:
        h = _admin(c, admin_email, admin_password)
        r = c.post("/api/admin/users/bulk", headers=h, json={"prefix": "EVAL", "start": 1, "count": accounts})
        created = r.json()["created"]
        if created:
            with out.open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["account_code", "email", "temporary_password"])
                w.writeheader()
                w.writerows(created)
            print(f"Created {len(created)} accounts; temporary passwords written to {out}")
        if r.json()["skipped"]:
            print("Already existed:", ", ".join(r.json()["skipped"]))
        if samples:
            prepared = []
            for folder in sorted(p for p in samples.iterdir() if p.is_dir()):
                refs = sorted((folder / "references").glob("*.*"))
                if not refs:
                    continue
                cid = c.post("/api/clients", headers=h, json={"full_name": folder.name, "notes": "Evaluation test client"}).json()["id"]
                files = [("files", (p.name, p.read_bytes(), "image/png")) for p in refs[:20]]
                res = c.post(f"/api/clients/{cid}/static/enroll", headers=h, files=files).json()
                print(f"{folder.name}: {len(res['accepted'])} references added, {len(res['rejected'])} rejected")
                prepared.append(cid)
            # Every test account can screen against the prepared clients (read-only).
            for cid in prepared:
                c.put(f"/api/admin/clients/{cid}/access", headers=h, json={"all_test_accounts": True})
            print(f"Gave all test accounts access to {len(prepared)} prepared client(s).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("demo", "eval"):
        p = sub.add_parser(name)
        p.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "admin@forgeblock.local"))
        p.add_argument("--admin-password", required=True, help="the admin's current (changed) password")
        if name == "eval":
            p.add_argument("--accounts", type=int, default=50)
            p.add_argument("--samples", type=Path)
            p.add_argument("--out", type=Path, default=Path("eval_accounts.csv"))
    a = ap.parse_args()
    if a.cmd == "demo":
        seed_demo(a.admin_email, a.admin_password)
    else:
        seed_eval(a.admin_email, a.admin_password, a.accounts, a.samples, a.out)
