"""Dataset plumbing for training. Kept separate so evaluate.py and export.py
tokenise exactly the same way the trained model was fed."""

from __future__ import annotations

import json
from pathlib import Path

import torch
from torch.utils.data import Dataset

from model import LABELS

MAX_LENGTH = 64  # ~one ASR window. p99 of the dataset is well under this.


def load_jsonl(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


class ManipulationDataset(Dataset):
    def __init__(self, rows: list[dict], tokenizer, max_length: int = MAX_LENGTH):
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        row = self.rows[i]
        enc = self.tokenizer(
            row["text"],
            truncation=True,
            max_length=self.max_length,
            padding="max_length",
            return_tensors="pt",
        )
        return {
            "input_ids": enc["input_ids"].squeeze(0),
            "attention_mask": enc["attention_mask"].squeeze(0),
            "labels": torch.tensor([float(row["labels"][l]) for l in LABELS]),
        }


def positive_weights(rows: list[dict], power: float = 0.5) -> torch.Tensor:
    """pos_weight for BCEWithLogitsLoss: (neg/pos) ** power, per label.

    Without any weighting, a label present in 15% of rows is best served by
    predicting 'no' every time and recall on the rarer tactics collapses.

    With the FULL neg/pos ratio the opposite happens: measured on the first
    training run, micro precision on the authored holdout fell to 0.50 while
    recall rose to 0.61. In a product that interrupts payments, a false positive
    costs a real transaction, so precision is the expensive side.

    `power=0.5` (the square root of the ratio) is the compromise: it still lifts
    the rare labels, without buying recall at any price.
    """
    n = len(rows)
    weights = []
    for label in LABELS:
        pos = sum(r["labels"][label] for r in rows)
        neg = n - pos
        weights.append((neg / max(pos, 1)) ** power)
    return torch.tensor(weights, dtype=torch.float32)
