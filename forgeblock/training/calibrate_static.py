"""
ForgeBlock - confidence calibration test for the STATIC module (SigNet + CEDAR or own sheets)
--------------------------------------------------------------------------------------------
Compares the CURRENT confidence (v8.2 z-score) with a CALIBRATED probability
(Platt / logistic calibration, Platt 1999), using ForgeBlock's own screening rules.

Colab:
    !pip install -q scikit-learn opencv-python-headless
    !python calibrate_static.py --data /content/CEDAR --model /content/embedding_signet.keras

--data   folder with  full_org/original_<w>_<i>.png  and  full_forg/forgeries_<w>_<i>.png
         (CEDAR layout; crop_sheets.py writes your own sheets in the same layout)
--model  your .keras embedding (or Siamese) model
--refs   references per writer (default 10)  -> genuine 1..refs are enrolled,
         the remaining genuine + all forgeries of that writer are screened
--writers optional, e.g. 46-55  (use writers the model was NOT trained on, if you know the split)

Output: calibration_static_results.json and calibration_static.png in --out (default .)
"""
import argparse, json, re
from itertools import combinations
from math import erf, sqrt
from pathlib import Path

import cv2
import numpy as np

# ---------------------------------------------------------------- ForgeBlock preprocessing (same as app)
def preprocess(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    bg = cv2.GaussianBlur(gray, (31, 31), 0)
    norm = cv2.divide(gray, bg, scale=255)
    enh = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(norm)
    hp = cv2.subtract(enh, cv2.GaussianBlur(enh, (9, 9), 0))
    sharp = cv2.addWeighted(enh, 0.8, hp, 0.5, 0)
    _, mask = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    crop = enh
    if cnts:
        x, y, w, h = cv2.boundingRect(np.vstack(cnts)); pw, ph = int(.12 * w), int(.12 * h)
        H, W = enh.shape; x0, y0, x1, y1 = max(0, x - pw), max(0, y - ph), min(W, x + w + pw), min(H, y + h + ph)
        if x1 > x0 and y1 > y0: crop = enh[y0:y1, x0:x1]
    r = cv2.resize(crop, (224, 224), interpolation=cv2.INTER_AREA)
    return (cv2.cvtColor(r, cv2.COLOR_GRAY2RGB).astype(np.float32) - 127.5) / 127.5

def load_model(path):
    import keras
    class L2NormalizationLayer(keras.layers.Layer):
        def call(self, x): return keras.ops.normalize(x, axis=-1, order=2)
    m = keras.models.load_model(path, compile=False, safe_mode=False,
                                custom_objects={"L2NormalizationLayer": L2NormalizationLayer})
    if len(m.inputs) > 1:
        m = next(l for l in m.layers if isinstance(l, keras.Model) and len(l.inputs) == 1)
    return m

def embed(model, paths, bs=32):
    shp = tuple(model.inputs[0].shape[1:3]); ch = model.inputs[0].shape[-1]
    out = []
    for i in range(0, len(paths), bs):
        xs = []
        for p in paths[i:i + bs]:
            x = preprocess(cv2.imread(str(p)))
            if shp != (224, 224): x = cv2.resize(x, shp[::-1])
            if ch == 1: x = x[..., :1]
            xs.append(x)
        e = np.asarray(model(np.stack(xs), training=False), dtype=np.float64)
        out.append(e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-12))
    return np.vstack(out)

# ---------------------------------------------------------------- ForgeBlock decision rules (v8.2)
K = 1.5
def pm(a, b): return np.array([a @ b, np.linalg.norm(a - b), np.abs(a - b).sum()])   # cos, euc, man
def intra(refs):
    P = np.array([pm(a, b) for a, b in combinations(refs, 2)]); return P.mean(0), P.std(0)
def thresholds(mean, sd, bounds):
    return np.array([np.clip(mean[0] - K * sd[0], *bounds[0]), np.clip(mean[1] + K * sd[1], *bounds[1]),
                     np.clip(mean[2] + K * sd[2], *bounds[2])])
def zs(m, t, mean, sd):
    """z past threshold toward genuine, per metric (same scaling as decision.py)."""
    sign = np.array([1, -1, -1]); to_perf = np.array([1 - t[0], t[1], t[2]])
    gain = sign * (m - t); to_typ = sign * (mean - t)
    s = np.maximum(np.maximum(sd, to_typ / K), 0.05 * to_perf)
    return gain / (s + 1e-12)
def phi(z): return 0.5 * (1 + erf(z / sqrt(2)))

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--model", required=True)
    ap.add_argument("--refs", type=int, default=10); ap.add_argument("--writers", default="")
    ap.add_argument("--out", default="."); ap.add_argument("--inconclusive-below", type=float, default=20)
    a = ap.parse_args()
    bounds = [(0.80, 0.97), (0.25, 0.63), (3.2, 8.0)]          # static_config.json bounds
    data = Path(a.data); rx = re.compile(r"_(\d+)_(\d+)\.png$", re.I)
    def files(sub):
        d = {}
        for p in (data / sub).glob("*.png"):
            m = rx.search(p.name)
            if m: d.setdefault(int(m[1]), {})[int(m[2])] = p
        return d
    G, F = files("full_org"), files("full_forg")
    writers = sorted(set(G) & set(F))
    if a.writers:
        lo, hi = map(int, a.writers.split("-")); writers = [w for w in writers if lo <= w <= hi]
    print(f"{len(writers)} writers, model {a.model}")
    model = load_model(a.model)
    rows = []
    for w in writers:
        g = [G[w][i] for i in sorted(G[w])]; f = [F[w][i] for i in sorted(F[w])]
        if len(g) <= a.refs: continue
        E = embed(model, g + f); refs, tests = E[:a.refs], E[a.refs:]
        truth = [1] * (len(g) - a.refs) + [0] * len(f)
        mean, sd = intra(list(refs)); t = thresholds(mean, sd, bounds)
        for e, y in zip(tests, truth):
            m = np.mean([pm(e, r) for r in refs], axis=0)
            votes = [m[0] >= t[0], m[1] <= t[1], m[2] <= t[2]]
            gen = sum(votes) >= 2; z = zs(m, t, mean, sd)
            conf = min(99.0, np.mean([max(0, 2 * phi(v if gen else -v) - 1) for v in z]) * 100)
            rows.append(dict(writer=w, y=y, z=float(np.mean(z)), z3=z.tolist(), gen=bool(gen), conf=float(conf), votes=[bool(v) for v in votes]))
        print(f"  writer {w}: done", end="\r")
    analyse(rows, a)

def analyse(rows, a):
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import GroupKFold
    y = np.array([r["y"] for r in rows]); g = np.array([r["writer"] for r in rows])
    z = np.clip([r["z"] for r in rows], -15, 15)[:, None]
    c = np.array([r["conf"] for r in rows]) / 100; gen = np.array([r["gen"] for r in rows])
    p_old = np.where(gen, .5 + .5 * c, .5 - .5 * c)
    p_new = np.zeros(len(y))
    for tr, te in GroupKFold(min(5, len(set(g)))).split(z, y, g):
        p_new[te] = LogisticRegression(C=1e6).fit(z[tr], y[tr]).predict_proba(z[te])[:, 1]
    full = LogisticRegression(C=1e6).fit(z, y)
    def ece(p, n=10):
        b = np.minimum((p * n).astype(int), n - 1)
        return float(sum(abs(p[b == i].mean() - y[b == i].mean()) * (b == i).mean() for i in range(n) if (b == i).any()))
    def summ(lab):
        dec = lab != "inconclusive"
        return dict(inconclusive_pct=round(100 * (~dec).mean(), 1),
                    forgeries_accepted_pct=round(100 * ((lab == "consistent") & (y == 0)).sum() / max(1, (y == 0).sum()), 1),
                    genuine_rejected_pct=round(100 * ((lab == "inconsistent") & (y == 1)).sum() / max(1, (y == 1).sum()), 1))
    lab_cur = np.array(["inconclusive" if r["conf"] < a.inconclusive_below else ("consistent" if r["gen"] else "inconsistent") for r in rows])
    lab_new = np.where(p_new >= .65, "consistent", np.where(p_new <= .35, "inconsistent", "inconclusive"))
    res = dict(screenings=len(y), writers=len(set(g)), genuine=int(y.sum()), forgeries=int((1 - y).sum()),
               auc=round(float(roc_auc_score(y, z[:, 0])), 3),
               platt_a=float(full.coef_[0][0]), platt_b=float(full.intercept_[0]),
               current=dict(brier=round(float(np.mean((p_old - y) ** 2)), 4), ece_pct=round(100 * ece(p_old), 1), **summ(lab_cur)),
               calibrated=dict(brier=round(float(np.mean((p_new - y) ** 2)), 4), ece_pct=round(100 * ece(p_new), 1), **summ(lab_new)))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    json.dump(dict(summary=res, rows=rows), open(out / "calibration_static_results.json", "w"))
    print("\n" + json.dumps(res, indent=1))
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.4))
    zz = np.linspace(-10, 10, 300); A, B = res["platt_a"], res["platt_b"]
    j = np.random.default_rng(0).uniform(-.02, .02, len(y))
    ax[0].scatter(z[y == 1, 0], 1.03 + j[y == 1], s=6, c="#1f77b4", alpha=.4, label="genuine")
    ax[0].scatter(z[y == 0, 0], -.03 + j[y == 0], s=6, c="#d62728", alpha=.4, label="forgery")
    ax[0].plot(zz, 1 / (1 + np.exp(-(A * zz + B))), "k", lw=2, label="fitted logistic curve")
    ax[0].axhspan(.35, .65, color="orange", alpha=.15, label="Inconclusive band")
    ax[0].set(xlabel="mean z past personal thresholds", ylabel="P(genuine)", title="Platt calibration (static)"); ax[0].legend(fontsize=8)
    for p, lab, col in [(p_old, "current z-score confidence", "#999"), (p_new, "calibrated probability", "#2a6fdb")]:
        b = np.minimum((p * 10).astype(int), 9); k = [i for i in range(10) if (b == i).sum() >= 5]
        ax[1].plot([p[b == i].mean() for i in k], [y[b == i].mean() for i in k], "o-", color=col, label=f"{lab} (ECE {100*ece(p):.1f}%)")
    ax[1].plot([0, 1], [0, 1], "k--", lw=1, label="perfect"); ax[1].set(xlabel="predicted P(genuine)", ylabel="actual share genuine", title="Reliability diagram"); ax[1].legend(fontsize=8)
    ax[2].hist(p_new[y == 1], 20, range=(0, 1), alpha=.6, color="#1f77b4", label="genuine"); ax[2].hist(p_new[y == 0], 20, range=(0, 1), alpha=.6, color="#d62728", label="forgery")
    ax[2].axvspan(.35, .65, color="orange", alpha=.15); ax[2].set(xlabel="calibrated P(genuine)", title="Distribution (held-out writers)"); ax[2].legend(fontsize=8)
    plt.tight_layout(); plt.savefig(out / "calibration_static.png", dpi=150)
    print(f"saved {out/'calibration_static.png'}")
    import hashlib
    h = hashlib.sha256(Path(a.model).read_bytes()).hexdigest()[:16]
    snippet = {"static": {h: {"a": round(res["platt_a"], 4), "b": round(res["platt_b"], 4),
                              "fitted_on": f"{res['writers']} writers, {res['screenings']} screenings ({a.data})",
                              "auc": res["auc"]}}}
    print("\nPaste into backend/weights/calibration.json (static section):")
    print(json.dumps(snippet, indent=2))

if __name__ == "__main__":
    main()
