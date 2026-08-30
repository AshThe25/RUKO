#!/usr/bin/env python3
"""Measure whether the six-tactic model detects the same intent in Hinglish.

    ml/.venv/bin/python ml/evaluation/probe_hinglish_parity.py

WHY: India's digital-arrest calls are conducted in Hindi and Hinglish, so this
is the language the product most needs. The hand-authored holdout is almost
entirely English, which means the honest headline number cannot see a Hinglish
failure — and worse, penalises a model that spends capacity on Hinglish. This
probe is the missing measurement.

Each pair is the same intent twice. A tactic that fires in English and misses in
Hinglish is a coverage gap, not a threshold problem, and no amount of tuning
fixes it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

REPO = Path(__file__).resolve().parents[2]
MODEL = REPO / "ml/models/ruko-manip-v1/onnx/model_int8.onnx"
TOKENIZER = REPO / "ml/models/ruko-manip-v1/tokenizer"
CONFIG = REPO / "mobile/src/risk/classifier/modelConfig.generated.ts"

LABELS = ["authority", "coercion", "urgency",
          "financialInstruction", "secrecy", "credentialRequest"]

# (tactic that should fire, English, Hinglish with the same intent)
PAIRS = [
    ("financialInstruction",
     "Transfer 48000 to this account immediately.",
     "Turant 48000 is account mein transfer kar dijiye."),
    ("financialInstruction",
     "Send the money to the UPI id I am giving you.",
     "Main jo UPI id de raha hoon us par paise bhej dijiye."),
    ("coercion",
     "Your account will be frozen if you do not comply.",
     "Aapka account block ho jayega agar aapne nahi kiya."),
    ("coercion",
     "A case has been filed and you will be arrested.",
     "Aapke naam par case hai, aap arrest ho jaayenge."),
    ("urgency",
     "Do this immediately, there is no time.",
     "Yeh abhi kijiye, bilkul time nahi hai."),
    ("credentialRequest",
     "Tell me the OTP you just received.",
     "Aapko jo OTP aaya hai wo bata dijiye."),
    ("secrecy",
     "Do not tell anyone about this call.",
     "Is call ke baare mein kisi ko mat bataiye."),
    ("authority",
     "I am calling from the crime branch.",
     "Main crime branch se bol raha hoon."),
]


def main() -> int:
    if not MODEL.exists():
        print(f"missing {MODEL}", file=sys.stderr)
        return 2

    block = CONFIG.read_text().split("LABEL_THRESHOLDS")[1].split("}")[0]
    thresholds = {k: float(v) for k, v in re.findall(r"(\w+):\s*([0-9.]+),", block)}

    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    tokenizer = AutoTokenizer.from_pretrained(str(TOKENIZER))

    def fires(text: str, tactic: str) -> tuple[bool, float]:
        enc = tokenizer(text, truncation=True, max_length=64,
                        padding="max_length", return_tensors="np")
        feeds = {i.name: enc[i.name].astype(np.int64)
                 for i in session.get_inputs() if i.name in enc}
        logits = session.run(None, feeds)[0].reshape(-1)
        score = float(1 / (1 + np.exp(-logits[LABELS.index(tactic)])))
        return score >= thresholds[tactic], score

    gaps = 0
    print(f"{'tactic':22}{'EN':>6}{'HI':>6}   verdict")
    for tactic, english, hinglish in PAIRS:
        en_fires, en_score = fires(english, tactic)
        hi_fires, hi_score = fires(hinglish, tactic)
        if en_fires and not hi_fires:
            verdict = "HINGLISH MISS"
            gaps += 1
        elif en_fires and hi_fires:
            verdict = "ok"
        elif not en_fires:
            verdict = "weak in both"
        else:
            verdict = "hinglish only"
        print(f"{tactic:22}{en_score:6.2f}{hi_score:6.2f}   {verdict}")

    print(f"\nHinglish misses where English fires: {gaps}/{len(PAIRS)}")
    if gaps:
        print("\nThis is a training-coverage gap. Note that fixing it by adding")
        print("Hinglish families alone regressed the authored holdout (0.657 ->")
        print("0.600), because that holdout is English and penalises the capacity")
        print("spent. Hinglish rows have to go into the holdout first, or the")
        print("measurement will keep rejecting the fix.")
    return 1 if gaps else 0


if __name__ == "__main__":
    raise SystemExit(main())
