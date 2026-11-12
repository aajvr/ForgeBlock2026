"""Adds the v8.16 static calibration to backend/weights/calibration.json.

Run from your ForgeBlock folder:   python tools/add_static_calibration_v816.py
It only ADDS two entries (keyed by the new model's fingerprint) and keeps
everything else in calibration.json, including the old model's entries and
the dynamic module's. A backup calibration.json.bak-v816 is written first.
"""
import json, shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
cal = root / "backend" / "weights" / "calibration.json"
new = json.loads((Path(__file__).resolve().parent / "calibration_v816_entries.json").read_text())
data = json.loads(cal.read_text()) if cal.exists() else {}
if cal.exists():
    shutil.copy(cal, cal.with_name("calibration.json.bak-v816"))
for module, entries in new.items():
    data.setdefault(module, {}).update(entries)
cal.write_text(json.dumps(data, indent=2))
print("Added:", {m: list(e) for m, e in new.items()}, "->", cal)
