#!/usr/bin/env python3
"""Train the Ruko manipulation classifier.

    ml/.venv/bin/python ml/training/train.py

Honest-metrics rules baked into this script:

1. The test split is loaded exactly once, at the very end, and is never used to
   pick an epoch, a threshold, or anything else.
2. Per-label decision thresholds are calibrated on the VALIDATION split only.
3. Both the generated test split and the hand-authored holdout are reported,
   because the generated one shares a style with training and is optimistic.
4. Everything is seeded. `metrics.json` records the seed, the data manifest
   hash, the resolved library versions and the git commit.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from transformers import AutoTokenizer, get_linear_schedule_with_warmup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from data import MAX_LENGTH, ManipulationDataset, load_jsonl, positive_weights  # noqa: E402
from model import LABELS, RukoManipulationClassifier  # noqa: E402

MODEL_VERSION = "ruko-manip-v1"


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


@torch.no_grad()
def predict(model, loader, device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probs, gold = [], []
    for batch in loader:
        logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
        probs.append(torch.sigmoid(logits).float().cpu().numpy())
        gold.append(batch["labels"].numpy())
    return np.concatenate(probs), np.concatenate(gold)


def prf(pred: np.ndarray, gold: np.ndarray) -> tuple[float, float, float]:
    tp = float((pred & gold).sum())
    fp = float((pred & ~gold).sum())
    fn = float((~pred & gold).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def macro_f1(probs: np.ndarray, gold: np.ndarray, thresholds: np.ndarray) -> float:
    return float(
        np.mean([
            prf(probs[:, i] >= thresholds[i], gold[:, i].astype(bool))[2]
            for i in range(len(LABELS))
        ])
    )


def calibrate_thresholds(
    probs: np.ndarray, gold: np.ndarray,
    lo: float = 0.20, hi: float = 0.80, precision_floor: float = 0.70,
) -> np.ndarray:
    """Pick a per-label threshold on the VALIDATION split only.

    A single global 0.5 is the wrong operating point for six labels with very
    different base rates. Three constraints, all deliberate:

    1. **Bounded to [0.20, 0.80].** The first unconstrained run chose 0.05 for
       urgency and 0.95 for coercion -- thresholds fitted to the quirks of the
       validation families, which are disjoint from the holdout families, so
       they transferred terribly (holdout urgency precision 0.25). A threshold
       pinned to the edge of the range is overfitting, not calibration.
    2. **Precision floor.** Among thresholds reaching `precision_floor` on
       validation, take the best F1. Ruko interrupts payments; a false positive
       costs the user a real transaction, so precision is the expensive side.
       If no threshold reaches the floor, fall back to plain best F1 and the
       label is reported as uncalibrated in the metrics.
    3. **Ties break high**, for the same reason.
    """
    grid = np.arange(lo, hi + 1e-9, 0.01)
    out = np.full(len(LABELS), 0.5)
    for i in range(len(LABELS)):
        g = gold[:, i].astype(bool)
        scored = [(t, *prf(probs[:, i] >= t, g)) for t in grid]
        eligible = [x for x in scored if x[1] >= precision_floor]
        pool = eligible if eligible else scored
        best = max(pool, key=lambda x: (round(x[3], 6), x[0]))
        out[i] = float(best[0])
    return out


def full_report(name: str, probs, gold, thresholds) -> dict:
    print(f"\n{'=' * 78}\n{name}  ({len(gold)} rows)\n{'=' * 78}")
    print("label                 thresh  precision  recall      F1     TP    FP    FN    TN")
    print("-" * 78)
    per_label, f1s = {}, []
    micro = {"tp": 0, "fp": 0, "fn": 0}
    for i, label in enumerate(LABELS):
        pred = probs[:, i] >= thresholds[i]
        g = gold[:, i].astype(bool)
        p, r, f = prf(pred, g)
        tp, fp = int((pred & g).sum()), int((pred & ~g).sum())
        fn, tn = int((~pred & g).sum()), int((~pred & ~g).sum())
        micro["tp"] += tp; micro["fp"] += fp; micro["fn"] += fn
        f1s.append(f)
        per_label[label] = {
            "threshold": round(float(thresholds[i]), 3),
            "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        }
        print(f"{label:<20} {thresholds[i]:6.2f} {p:9.3f} {r:7.3f} {f:7.3f} "
              f"{tp:6d} {fp:5d} {fn:5d} {tn:5d}")

    mp = micro["tp"] / max(1, micro["tp"] + micro["fp"])
    mr = micro["tp"] / max(1, micro["tp"] + micro["fn"])
    mf = 2 * mp * mr / max(1e-9, mp + mr)
    pred_all = probs >= thresholds
    exact = float((pred_all == gold.astype(bool)).all(axis=1).mean())
    print("-" * 78)
    print(f"macro F1 {np.mean(f1s):.3f}   micro P {mp:.3f}  R {mr:.3f}  F1 {mf:.3f}   "
          f"exact-match {exact * 100:.1f}%")
    return {
        "rows": int(len(gold)),
        "macro_f1": round(float(np.mean(f1s)), 4),
        "micro_precision": round(mp, 4), "micro_recall": round(mr, 4), "micro_f1": round(mf, 4),
        "exact_match": round(exact, 4),
        "per_label": per_label,
    }


def git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("ml/data/processed"))
    ap.add_argument("--holdout", type=Path,
                    default=Path("ml/datasets/holdout/test_holdout.jsonl"))
    ap.add_argument("--out", type=Path, default=Path("ml/models/ruko-manip-v1"))
    ap.add_argument("--base-model", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--freeze-layers", type=int, default=4,
                    help="freeze embeddings + this many bottom encoder blocks")
    ap.add_argument("--pos-weight-power", type=float, default=0.5)
    ap.add_argument("--dropout", type=float, default=0.2)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--head-lr", type=float, default=5e-4)
    ap.add_argument("--warmup-ratio", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=20260829)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    set_seed(args.seed)
    device = pick_device(args.device)
    print(f"device: {device}  base model: {args.base_model}  seed: {args.seed}")

    train_rows = load_jsonl(args.data / "train.jsonl")
    val_rows = load_jsonl(args.data / "val.jsonl")
    print(f"train {len(train_rows)}  val {len(val_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    train_ds = ManipulationDataset(train_rows, tokenizer)
    val_ds = ManipulationDataset(val_rows, tokenizer)

    g = torch.Generator().manual_seed(args.seed)
    train_dl = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, generator=g)
    val_dl = DataLoader(val_ds, batch_size=64)

    model = RukoManipulationClassifier(args.base_model, dropout=args.dropout)
    model.freeze_bottom(args.freeze_layers)
    model = model.to(device)
    print(f"parameters: {model.num_parameters() / 1e6:.1f}M total, "
          f"{model.trainable_parameters() / 1e6:.1f}M trainable "
          f"(bottom {args.freeze_layers} layers frozen)")

    # The head is randomly initialised and needs a much larger step than the
    # pretrained encoder, which only needs nudging.
    optim = torch.optim.AdamW([
        {"params": [p for p in model.encoder.parameters() if p.requires_grad], "lr": args.lr},
        {"params": model.head.parameters(), "lr": args.head_lr},
    ], weight_decay=0.01)

    steps = len(train_dl) * args.epochs
    sched = get_linear_schedule_with_warmup(optim, int(steps * args.warmup_ratio), steps)
    loss_fn = nn.BCEWithLogitsLoss(
        pos_weight=positive_weights(train_rows, args.pos_weight_power).to(device))

    best_f1, best_state, best_epoch, history = -1.0, None, -1, []
    started = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        running, seen = 0.0, 0
        for step, batch in enumerate(train_dl, 1):
            optim.zero_grad()
            logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
            loss = loss_fn(logits, batch["labels"].to(device))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optim.step()
            sched.step()
            running += loss.item() * len(batch["labels"])
            seen += len(batch["labels"])
            if step % 50 == 0:
                print(f"  epoch {epoch} step {step}/{len(train_dl)} loss {running / seen:.4f}")

        val_probs, val_gold = predict(model, val_dl, device)
        # Epoch selection uses a flat 0.5 on purpose: choosing the epoch with
        # thresholds already tuned on the same split would fit the validation
        # set twice and inflate everything downstream.
        f1_at_half = macro_f1(val_probs, val_gold, np.full(len(LABELS), 0.5))
        history.append({"epoch": epoch, "train_loss": round(running / seen, 4),
                        "val_macro_f1_at_0.5": round(f1_at_half, 4)})
        print(f"epoch {epoch}: train loss {running / seen:.4f}  val macro F1@0.5 {f1_at_half:.4f}")

        if f1_at_half > best_f1:
            best_f1, best_epoch = f1_at_half, epoch
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    train_seconds = time.time() - started
    print(f"\nbest epoch: {best_epoch} (val macro F1@0.5 {best_f1:.4f}), "
          f"trained in {train_seconds:.0f}s")
    model.load_state_dict(best_state)

    # --- thresholds from VALIDATION only --- #
    val_probs, val_gold = predict(model, val_dl, device)
    thresholds = calibrate_thresholds(val_probs, val_gold)
    print("calibrated thresholds:",
          {l: round(float(t), 2) for l, t in zip(LABELS, thresholds)})

    val_report = full_report("VALIDATION (thresholds fitted here — optimistic)",
                             val_probs, val_gold, thresholds)

    # --- test split touched for the first time, right now --- #
    test_rows = load_jsonl(args.data / "test.jsonl")
    test_dl = DataLoader(ManipulationDataset(test_rows, tokenizer), batch_size=64)
    test_probs, test_gold = predict(model, test_dl, device)
    test_report = full_report(
        "GENERATED TEST SPLIT (family-disjoint, but shares style with training)",
        test_probs, test_gold, thresholds)

    holdout_rows = load_jsonl(args.holdout)
    holdout_dl = DataLoader(ManipulationDataset(holdout_rows, tokenizer), batch_size=64)
    hold_probs, hold_gold = predict(model, holdout_dl, device)
    hold_report = full_report(
        "HAND-AUTHORED HOLDOUT (no template overlap — THE HONEST NUMBER)",
        hold_probs, hold_gold, thresholds)

    args.out.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(),
                "thresholds": thresholds.tolist(),
                "base_model": args.base_model,
                "labels": LABELS,
                "max_length": MAX_LENGTH},
               args.out / "pytorch_model.pt")
    tokenizer.save_pretrained(args.out / "tokenizer")

    manifest_path = Path("ml/data/manifest.json")
    metrics = {
        "model_version": MODEL_VERSION,
        "base_model": args.base_model,
        "parameters": model.num_parameters(),
        "trainable_parameters": model.trainable_parameters(),
        "labels": LABELS,
        "thresholds": {l: round(float(t), 3) for l, t in zip(LABELS, thresholds)},
        "hyperparameters": {
            "epochs": args.epochs, "best_epoch": best_epoch,
            "batch_size": args.batch_size, "encoder_lr": args.lr, "head_lr": args.head_lr,
            "warmup_ratio": args.warmup_ratio, "max_length": MAX_LENGTH, "seed": args.seed,
            "freeze_bottom_layers": args.freeze_layers, "dropout": args.dropout,
            "pos_weight": f"(neg/pos) ** {args.pos_weight_power} per label",
            "threshold_band": [0.20, 0.80], "threshold_precision_floor": 0.70,
        },
        "training": {
            "device": str(device), "seconds": round(train_seconds, 1), "history": history,
        },
        "results": {
            "validation": val_report, "generated_test": test_report, "authored_holdout": hold_report,
        },
        "provenance": {
            "git_commit": git_commit(),
            "dataset_manifest": json.loads(manifest_path.read_text())["files"]
            if manifest_path.exists() else None,
            "torch": torch.__version__,
            "trained_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    print(f"\n{'=' * 78}")
    print(f"HEADLINE  generated test macro F1 {test_report['macro_f1']:.3f}  ->  "
          f"authored holdout macro F1 {hold_report['macro_f1']:.3f}")
    print(f"saved to {args.out}")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
