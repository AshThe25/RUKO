#!/usr/bin/env python3
"""Score the QUANTISED fraud gate on test and the India stress set.

    python3 ml/evaluation/evaluate_fraud_gate.py

WHY THIS EXISTS: the 0.9858 F1 in the model card was measured on the fp32
checkpoint. The artefact that ships is int8, and dynamic quantisation already
moved a probe case from 0.546 to 0.425 -- across the 0.46 threshold. Quoting an
fp32 number for an int8 build is the exact failure this repo refuses elsewhere,
so the shipped artefact gets its own measurement.

The threshold is taken from the checkpoint and is NOT re-fitted here. Re-fitting
on test would make the number meaningless.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import ML_DIR  # noqa: E402

MODEL_DIR = ML_DIR / "models" / "ruko-real-multisource-v1"
sigmoid = lambda x: 1.0 / (1.0 + np.exp(-x))  # noqa: E731


def score_all(sess, tok, texts, batch=64):
    out = []
    for i in range(0, len(texts), batch):
        enc = tok(texts[i:i + batch], truncation=True, max_length=64,
                  padding="max_length", return_tensors="np")
        logits = sess.run(None, {"input_ids": enc["input_ids"].astype("int64"),
                                 "attention_mask": enc["attention_mask"].astype("int64")})[0]
        out.extend(sigmoid(logits.reshape(-1)).tolist())
    return out


def main() -> int:
    import torch
    ckpt = torch.load(MODEL_DIR / "pytorch_model.pt", map_location="cpu", weights_only=False)
    threshold = float(ckpt.get("threshold", 0.5))

    onnx_path = MODEL_DIR / "onnx" / "model_int8.onnx"
    if not onnx_path.is_file():
        print("run ml/export/export_fraud_gate.py first", file=sys.stderr)
        return 1

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    tok_dir = MODEL_DIR / "tokenizer"
    tok = AutoTokenizer.from_pretrained(
        tok_dir if tok_dir.is_dir() else ckpt.get("base_model", "sentence-transformers/all-MiniLM-L6-v2"))

    report = {"artefact": "model_int8.onnx", "threshold_from_checkpoint": threshold, "splits": {}}

    test_path = ML_DIR / "data" / "real-multisource" / "test.jsonl"
    rows = [json.loads(line) for line in test_path.open()]
    texts = [r["text"] for r in rows]
    gold = [int(r["label"]) for r in rows]
    probs = score_all(sess, tok, texts)

    tp = sum(1 for p, g in zip(probs, gold) if p >= threshold and g == 1)
    fp = sum(1 for p, g in zip(probs, gold) if p >= threshold and g == 0)
    fn = sum(1 for p, g in zip(probs, gold) if p < threshold and g == 1)
    tn = sum(1 for p, g in zip(probs, gold) if p < threshold and g == 0)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0

    report["splits"]["test"] = {
        "n": len(rows), "precision": round(prec, 4), "recall": round(rec, 4),
        "f1": round(f1, 4), "accuracy": round((tp + tn) / len(rows), 4),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }
    print(f"\nINT8 test  n={len(rows)}  P {prec:.4f}  R {rec:.4f}  F1 {f1:.4f}  "
          f"(tp{tp} fp{fp} fn{fn} tn{tn})")

    out = MODEL_DIR / "evaluation_int8.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
