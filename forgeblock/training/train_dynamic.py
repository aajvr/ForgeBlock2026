"""Train the reference dynamic encoder (CNN-BiLSTM-attention Siamese) on SVC2004.

This is the Chapter 3 architecture, provided so the dynamic module can be
trained end to end. If the dynamic model is developed separately, it can
replace this; see backend/app/ml/dynamic_model.py for the plug-in contract.

SVC2004 layout (Task1 or Task2 folders):
    U<user>S<sample>.TXT   samples 1-20 genuine, 21-40 skilled forgeries
    first line = number of points, then rows: X Y timestamp button [az alt pressure]

Users are split by writer (no writer appears in more than one split) so the
reported results reflect unseen signers.

    python training/train_dynamic.py --svc data/SVC2004/Task2 --epochs 40
Writes backend/weights/dynamic_encoder.pt and dynamic_config.json.
"""
import argparse
import random
import re
from pathlib import Path

import numpy as np
import torch

from common import ROOT, classification_metrics, eer_threshold, round_dict, save_json, seed_everything

from app.ml import decision as dec  # noqa: E402
from app.ml.dynamic_features import stroke_features  # noqa: E402
from app.ml.networks import DynamicEncoder, contrastive_loss  # noqa: E402

WEIGHTS = ROOT / "backend" / "weights"
NAME_RE = re.compile(r"U(\d+)S(\d+)\.txt$", re.I)


def read_svc(path: Path) -> np.ndarray:
    rows = [l.split() for l in path.read_text().splitlines()[1:] if l.strip()]
    a = np.array([[float(r[0]), float(r[1]), float(r[2]), float(r[3])] for r in rows])
    a[:, 1] = -a[:, 1]  # SVC y axis points up; the browser's points down
    return a


def load_svc(root: Path) -> dict:
    """{user: {"genuine": [features], "forged": [features]}}"""
    data = {}
    for p in sorted(root.rglob("*")):
        m = NAME_RE.search(p.name)
        if not m:
            continue
        u, s = int(m.group(1)), int(m.group(2))
        try:
            feats = stroke_features(read_svc(p))
        except ValueError:
            continue
        data.setdefault(u, {"genuine": [], "forged": []})["genuine" if s <= 20 else "forged"].append(feats)
    if not data:
        raise SystemExit(f"No SVC2004 files found under {root}")
    return data


def make_pairs(data, users, per_user=150):
    pairs = []
    for u in users:
        g, f = data[u]["genuine"], data[u]["forged"]
        for _ in range(per_user):
            a, b = random.sample(range(len(g)), 2)
            pairs.append((g[a], g[b], 1.0))
            if f:
                pairs.append((g[random.randrange(len(g))], f[random.randrange(len(f))], 0.0))
            # random forgery: another writer's genuine signature
            v = random.choice([x for x in users if x != u]) if len(users) > 1 else u
            if v != u:
                pairs.append((g[random.randrange(len(g))], random.choice(data[v]["genuine"]), 0.0))
    random.shuffle(pairs)
    return pairs


@torch.no_grad()
def embed_all(model, feats):
    model.eval()
    return model(torch.from_numpy(np.stack(feats))).numpy()


def skilled_pair_scores(model, data, users):
    scores, labels = [], []
    for u in users:
        g = embed_all(model, data[u]["genuine"])
        f = embed_all(model, data[u]["forged"]) if data[u]["forged"] else np.zeros((0, g.shape[1]))
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                scores.append(float(g[i] @ g[j]))
                labels.append(True)
            for j in range(len(f)):
                scores.append(float(g[i] @ f[j]))
                labels.append(False)
    return scores, labels


def evaluate_verify(model, data, users, cfg, k_refs=5):
    y_true, y_pred = [], []
    for u in users:
        g = embed_all(model, data[u]["genuine"])
        f = embed_all(model, data[u]["forged"]) if data[u]["forged"] else []
        refs = list(g[:k_refs])
        tau = dec.dynamic_personal_threshold(refs, cfg) if len(refs) >= 5 else cfg["thresholds"]["cosine"]
        for e, genuine in [(e, True) for e in g[k_refs:]] + [(e, False) for e in f]:
            d = dec.dynamic_decision(dec.mean_metrics(e, refs), tau, "adaptive")
            y_true.append(genuine)
            y_pred.append(d.classification == "genuine")
    return round_dict(classification_metrics(y_true, y_pred))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--svc", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--margin", type=float, default=1.0)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--test-frac", type=float, default=0.15)
    args = ap.parse_args()

    seed_everything(42)
    data = load_svc(args.svc)
    users = sorted(data)
    random.shuffle(users)
    n_val = max(1, int(len(users) * args.val_frac))
    n_test = max(1, int(len(users) * args.test_frac))
    test_u, val_u, train_u = users[:n_test], users[n_test:n_test + n_val], users[n_test + n_val:]
    print(f"Users: train {len(train_u)}, val {len(val_u)}, test {len(test_u)}")

    model = DynamicEncoder()
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=4)
    best_eer, best_state = 1.0, None

    for epoch in range(1, args.epochs + 1):
        model.train()
        pairs = make_pairs(data, train_u)
        total = 0.0
        for i in range(0, len(pairs), args.batch):
            batch = pairs[i:i + args.batch]
            a = torch.from_numpy(np.stack([p[0] for p in batch]))
            b = torch.from_numpy(np.stack([p[1] for p in batch]))
            y = torch.tensor([p[2] for p in batch])
            loss = contrastive_loss(model(a), model(b), y, args.margin)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            total += loss.item() * len(batch)
        _, val_eer = eer_threshold(*skilled_pair_scores(model, data, val_u), higher_is_genuine=True)
        sched.step(val_eer)
        print(f"epoch {epoch:3d}  loss {total / len(pairs):.4f}  val EER {val_eer:.4f}")
        if val_eer < best_eer:
            best_eer, best_state = val_eer, {k: v.clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    tau, val_eer = eer_threshold(*skilled_pair_scores(model, data, val_u), higher_is_genuine=True)
    cfg = {"thresholds": {"cosine": tau}, "bounds": {"cosine": [max(0.0, tau - 0.25), min(0.99, tau + 0.15)]}}
    test_scores, test_labels = skilled_pair_scores(model, data, test_u)
    _, test_eer = eer_threshold(test_scores, test_labels, higher_is_genuine=True)
    compare_pred = [
        dec.dynamic_decision({"cosine": s, "euclidean": float(np.sqrt(max(0.0, 2 * (1 - s))))}, tau, "default").classification == "genuine"
        for s in test_scores
    ]
    cfg["evaluation"] = {
        "test_users": test_u,
        "val_eer": round(val_eer, 4),
        "compare": {**round_dict(classification_metrics(test_labels, compare_pred)), "eer": round(test_eer, 4)},
        "verify": evaluate_verify(model, data, test_u, cfg),
    }
    WEIGHTS.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict()}, WEIGHTS / "dynamic_encoder.pt")
    save_json(WEIGHTS / "dynamic_config.json", cfg)
    print("Test results:", cfg["evaluation"])
    print("Saved backend/weights/dynamic_encoder.pt and dynamic_config.json")


if __name__ == "__main__":
    main()
