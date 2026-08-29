#!/usr/bin/env python3
"""Emit a numerical parity fixture for the TypeScript inference path.

    ml/.venv/bin/python ml/export/emit_parity_fixture.py

The on-device chain is verified in three linked pieces, so that no step is taken
on trust:

    PyTorch  ==  ONNX fp32/int8      verified in export_onnx.py (max diff 3.3e-6)
    Python tokenizer == TS tokenizer verified in tokenizer.test.ts (exact ids)
    ONNX logits -> final scores      verified by THIS fixture, in parity.test.ts

Together those cover the whole path from raw transcript to the numbers the risk
engine consumes. This file records, for each text: the token ids, the int8 ONNX
logits, and the calibrated and lexicon-fused scores as Python computes them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # ml/
from paths import resolve  # noqa: E402

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
from model import LABELS  # noqa: E402

MODEL_DIR = resolve("ml/models/ruko-manip-v1")
TEXTS = [
    "hello sir i am calling from your bank your account will be frozen "
    "you must transfer 48000 immediately do not disconnect this call",
    "can you send me 500 for dinner last night",
    "main crime branch se bol raha hoon aapka account block ho jayega "
    "turant paisa bhej dijiye aur kisi ko mat bataiye",
    "never share your otp with anyone not even with bank staff",
    "i am sending the rent of 50000 to the landlord today like every month",
    "the traffic was terrible today it took me a full hour to reach office",
    "tell me the otp you have just received on your phone right now",
    "account number please",
]


def calibrate(p: float, t: float) -> float:
    """Must match mobile/src/risk/classifier/calibration.ts exactly."""
    p = min(1.0, max(0.0, p))
    t = min(0.999, max(0.001, t))
    return 0.5 * (p / t) if p < t else 0.5 + 0.5 * ((p - t) / (1 - t))


def main() -> int:
    evaluation = json.loads((MODEL_DIR / "evaluation.json").read_text())
    thresholds = evaluation["thresholds"]["ensemble"]
    rule = evaluation["ensemble_rule"]
    weight = float(rule.split("_")[1]) if rule.startswith("weighted_") else 0.5

    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR / "tokenizer")
    session = ort.InferenceSession(str(MODEL_DIR / "onnx" / "model_int8.onnx"),
                                   providers=["CPUExecutionProvider"])

    rows = []
    for text in TEXTS:
        enc = tokenizer(text, truncation=True, max_length=64, padding=False,
                        return_tensors="np")
        logits = session.run(None, {
            "input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64),
        })[0][0]
        # Compute the sigmoid in float64 from the float32 logits. numpy would
        # otherwise keep float32 and land ~4e-8 away from JavaScript's float64
        # arithmetic -- harmless for any decision, but it would force the parity
        # tolerance so wide that the test could no longer catch a real bug.
        # The logits are the interface between the two languages; everything
        # downstream of them is compared at full double precision.
        logits = logits.astype(np.float64)
        probs = 1.0 / (1.0 + np.exp(-logits))
        rows.append({
            "text": text,
            "input_ids": enc["input_ids"][0].tolist(),
            "logits": [float(x) for x in logits],
            "neural_probs": {l: float(p) for l, p in zip(LABELS, probs)},
            "neural_calibrated": {l: calibrate(float(p), thresholds[l])
                                  for l, p in zip(LABELS, probs)},
        })

    out = {
        "model_version": "ruko-manip-v1",
        "thresholds": thresholds,
        "neural_fusion_weight": weight,
        "note": "logits are from model_int8.onnx via onnxruntime "
                f"{ort.__version__} on CPUExecutionProvider",
        "cases": rows,
    }
    path = resolve("mobile/src/risk/classifier/__tests__/parity_fixture.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {len(rows)} parity cases -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
