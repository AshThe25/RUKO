#!/usr/bin/env python3
"""External, positives-only stress test on real India-associated smishing reports.

This script never selects a checkpoint or a threshold.  It reports sensitivity
only, because the IMC'25 corpus is a collection of reported smishing examples
and contains no legitimate-message control group.  The raw ``text`` field is
used; ``translation`` is intentionally ignored so no translated text enters the
evaluation.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from training.train_real_binary import BASE_MODEL, MAX_LENGTH, RealFraudGate  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402


def clean(text: str) -> str:
    return " ".join(text.replace("\x00", " ").split())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=Path, default=Path("ml/models/ruko-real-binary-v1"))
    ap.add_argument("--imc-csv", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    checkpoint = torch.load(args.model / "pytorch_model.pt", map_location="cpu")
    tokenizer = AutoTokenizer.from_pretrained(args.model / "tokenizer")
    model = RealFraudGate(checkpoint.get("base_model", BASE_MODEL))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    threshold = float(checkpoint["threshold"])

    seen: set[str] = set()
    examples: list[dict] = []
    with args.imc_csv.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("original_network_country") != "IND":
                continue
            text = clean(row.get("text", ""))
            key = hashlib.sha256(text.lower().encode("utf-8")).hexdigest()
            if len(text.split()) < 8 or key in seen:
                continue
            seen.add(key)
            examples.append({
                "text": text,
                "language": row.get("language", ""),
                "lures": [item for item in row.get("lure_principles", "").split(",") if item],
            })

    scores: list[float] = []
    with torch.no_grad():
        for start in range(0, len(examples), 128):
            batch = examples[start:start + 128]
            enc = tokenizer([item["text"] for item in batch], truncation=True,
                            max_length=MAX_LENGTH, padding=True, return_tensors="pt")
            probs = torch.sigmoid(model(enc["input_ids"], enc["attention_mask"])).tolist()
            scores.extend(float(score) for score in probs)

    flagged = [score >= threshold for score in scores]
    by_language: dict[str, dict] = {}
    for language in sorted({item["language"] or "unknown" for item in examples}):
        indices = [i for i, item in enumerate(examples) if (item["language"] or "unknown") == language]
        by_language[language] = {
            "n": len(indices),
            "sensitivity": round(sum(flagged[i] for i in indices) / len(indices), 4),
        }
    by_lure: dict[str, dict] = {}
    for lure in sorted({lure for item in examples for lure in item["lures"]}):
        indices = [i for i, item in enumerate(examples) if lure in item["lures"]]
        by_lure[lure] = {
            "n": len(indices),
            "sensitivity": round(sum(flagged[i] for i in indices) / len(indices), 4),
        }

    report = {
        "evaluation": "external positives-only sensitivity stress test",
        "source": {
            "name": "Smishing Dataset IMC'25",
            "url": "https://github.com/reportsmishing/Smishing-Dataset-IMC25",
            "license": "CC-BY-4.0",
            "file_sha256": sha256(args.imc_csv),
            "selection": "raw reported messages where original_network_country == IND; no translation field used",
        },
        "n_unique_real_india_associated_reports": len(examples),
        "model_threshold_from_validation_only": round(threshold, 3),
        "sensitivity": round(sum(flagged) / len(flagged), 4),
        "median_score": round(float(sorted(scores)[len(scores) // 2]), 4),
        "language_breakdown": by_language,
        "lure_breakdown": by_lure,
        "limitations": [
            "This is a real SMS/smishing corpus, not a telephone-call corpus.",
            "India is network metadata and may not prove recipient geography or Hinglish coverage.",
            "The set has no legitimate-message controls, so precision, specificity, accuracy, and F1 cannot be calculated.",
            "This evaluation does not train or calibrate the model and does not establish six-tactic model accuracy.",
        ],
    }
    destination = args.out or (args.model / "external_india_smishing.json")
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
