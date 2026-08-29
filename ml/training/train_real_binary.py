#!/usr/bin/env python3
"""Train Ruko's all-real binary fraud gate.

The input corpus is built only from real FTC robocalls and PII-redacted real
CallCenterEN conversations.  It intentionally does not share the existing
six-tactic model's synthetic dataset or its metrics.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel, AutoTokenizer, get_linear_schedule_with_warmup

MAX_LENGTH = 64
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
SEED = 20260830


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


class CallDataset(Dataset):
    def __init__(self, rows: list[dict], tokenizer):
        self.rows, self.tokenizer = rows, tokenizer

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict:
        row = self.rows[index]
        encoded = self.tokenizer(row["text"], truncation=True, max_length=MAX_LENGTH,
                                 padding="max_length", return_tensors="pt")
        return {
            "input_ids": encoded["input_ids"].squeeze(0),
            "attention_mask": encoded["attention_mask"].squeeze(0),
            "labels": torch.tensor(float(row["label"])),
        }


class RealFraudGate(nn.Module):
    def __init__(self, base_model: str, dropout: float = 0.2):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(base_model)
        hidden = self.encoder.config.hidden_size
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(hidden, 1))

    def freeze_bottom(self, layers: int) -> None:
        for parameter in self.encoder.embeddings.parameters():
            parameter.requires_grad = False
        for layer in self.encoder.encoder.layer[:layers]:
            for parameter in layer.parameters():
                parameter.requires_grad = False

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        output = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = output.last_hidden_state[:, 0]
        return self.head(pooled).squeeze(-1)


@torch.no_grad()
def predict(model, loader, device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probabilities, gold = [], []
    for batch in loader:
        logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
        probabilities.append(torch.sigmoid(logits).cpu().numpy())
        gold.append(batch["labels"].numpy())
    return np.concatenate(probabilities), np.concatenate(gold).astype(bool)


def report(probs: np.ndarray, gold: np.ndarray, threshold: float) -> dict:
    pred = probs >= threshold
    tp, fp = int((pred & gold).sum()), int((pred & ~gold).sum())
    fn, tn = int((~pred & gold).sum()), int((~pred & ~gold).sum())
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    return {
        "precision": round(precision, 4), "recall": round(recall, 4),
        "f1": round(f1, 4), "accuracy": round(float((pred == gold).mean()), 4),
        "threshold": round(threshold, 3), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def choose_threshold(probs: np.ndarray, gold: np.ndarray) -> float:
    # Fit on validation only.  Favour precision because Ruko intervenes before
    # payment; tie-break upward to reduce unnecessary alerts.
    candidates = []
    for threshold in np.arange(0.20, 0.81, 0.01):
        metrics = report(probs, gold, float(threshold))
        candidates.append((threshold, metrics))
    eligible = [(threshold, metrics) for threshold, metrics in candidates
                if metrics["precision"] >= 0.80]
    pool = eligible or candidates
    return float(max(pool, key=lambda item: (item[1]["f1"], item[0]))[0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("ml/data/real-binary"))
    ap.add_argument("--out", type=Path, default=Path("ml/models/ruko-real-binary-v1"))
    ap.add_argument("--model-version", default="ruko-real-binary-v1")
    ap.add_argument("--init-checkpoint", type=Path,
                    help="Optional all-real checkpoint to continue from; threshold is always recalibrated on this run's validation split.")
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device(args.device)

    train_rows = read_jsonl(args.data / "train.jsonl")
    val_rows = read_jsonl(args.data / "val.jsonl")
    test_rows = read_jsonl(args.data / "test.jsonl")
    data_manifest = json.loads((args.data / "manifest.json").read_text())
    print(f"all-real corpus: train={len(train_rows)} val={len(val_rows)} test={len(test_rows)}")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    generator = torch.Generator().manual_seed(args.seed)
    train_loader = DataLoader(CallDataset(train_rows, tokenizer), batch_size=args.batch_size,
                              shuffle=True, generator=generator)
    val_loader = DataLoader(CallDataset(val_rows, tokenizer), batch_size=128)
    test_loader = DataLoader(CallDataset(test_rows, tokenizer), batch_size=128)

    model = RealFraudGate(BASE_MODEL).to(device)
    if args.init_checkpoint:
        initial = torch.load(args.init_checkpoint, map_location=device)
        model.load_state_dict(initial["state_dict"])
        print(f"initialised from all-real checkpoint: {args.init_checkpoint}")
    model.freeze_bottom(4)
    encoder_params = [parameter for parameter in model.encoder.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW([
        {"params": encoder_params, "lr": 2e-5},
        {"params": model.head.parameters(), "lr": 5e-4},
    ], weight_decay=0.01)
    scheduler = get_linear_schedule_with_warmup(
        optimizer, int(len(train_loader) * args.epochs * 0.1), len(train_loader) * args.epochs)
    positives = sum(row["label"] for row in train_rows)
    negatives = len(train_rows) - positives
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor((negatives / max(1, positives)) ** 0.5,
                                                             device=device))

    best_f1, best_state, history = -1.0, None, []
    started = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train(); total_loss = 0.0; count = 0
        for batch in train_loader:
            optimizer.zero_grad()
            logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
            loss = loss_fn(logits, batch["labels"].to(device))
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step(); scheduler.step()
            total_loss += loss.item() * len(batch["labels"]); count += len(batch["labels"])
        val_probs, val_gold = predict(model, val_loader, device)
        threshold = choose_threshold(val_probs, val_gold)
        val_metrics = report(val_probs, val_gold, threshold)
        history.append({"epoch": epoch, "loss": round(total_loss / count, 4), **val_metrics})
        print(f"epoch {epoch}: loss={total_loss / count:.4f} val_f1={val_metrics['f1']:.4f} "
              f"P={val_metrics['precision']:.3f} R={val_metrics['recall']:.3f}")
        if val_metrics["f1"] > best_f1:
            best_f1 = val_metrics["f1"]
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}

    model.load_state_dict(best_state)
    val_probs, val_gold = predict(model, val_loader, device)
    threshold = choose_threshold(val_probs, val_gold)
    test_probs, test_gold = predict(model, test_loader, device)
    metrics = {
        "model_version": args.model_version,
        "task": data_manifest["task"],
        "base_model": BASE_MODEL,
        "max_length": MAX_LENGTH,
        "training_data": data_manifest,
        "training": {
            "epochs": args.epochs,
            "seconds": round(time.time() - started, 1),
            "initial_checkpoint": str(args.init_checkpoint) if args.init_checkpoint else None,
            "history": history,
        },
        "validation": report(val_probs, val_gold, threshold),
        "test": report(test_probs, test_gold, threshold),
        "honesty": [
            "All fine-tuning examples are human-origin transcripts; no synthetic/LLM-generated rows are included.",
            "FTC examples are enforcement-context suspected-illegal labels, not individual criminal convictions.",
            "This binary gate is not evidence of six-tactic classification accuracy or Indian/Hinglish performance.",
        ],
    }
    args.out.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "threshold": threshold, "base_model": BASE_MODEL,
                "max_length": MAX_LENGTH}, args.out / "pytorch_model.pt")
    tokenizer.save_pretrained(args.out / "tokenizer")
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps({"validation": metrics["validation"], "test": metrics["test"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
