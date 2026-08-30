#!/usr/bin/env python3
"""Probe the binary fraud gate on the traffic it would actually be wired to.

    ml/.venv/bin/python ml/evaluation/probe_fraud_gate_ood.py

WHY: the gate reports precision 0.9953 on its own test split, and the proposed
integration is `notificationSuspicion` — i.e. scoring the bank and transactional
SMS that arrive as Android notifications. Its legitimate class was built from
UCI SMS ham (personal English chat, 2012) and call-centre transcripts. Neither
contains an Indian transactional SMS, while its fraud class is full of Indian
smishing. So "financial vocabulary" and "fraud" are perfectly correlated in
training, and the split cannot detect it.

This probe is the missing negative control. It is not a benchmark; it is eleven
messages that a normal Indian phone receives in a normal week, and the gate
should call almost all of them legitimate.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

REPO = Path(__file__).resolve().parents[2]
MODEL = REPO / "mobile/android/app/src/main/assets/fraud_gate_int8.onnx"
CARD = REPO / "ml/models/ruko-real-multisource-v1/onnx/onnx_card.json"
TOKENIZER = REPO / "ml/models/ruko-real-multisource-v1/tokenizer"
OUT = REPO / "ml/models/ruko-real-multisource-v1/probe_ood_transactional.json"

# Ordinary, unambiguously legitimate Indian phone traffic.
LEGIT = [
    "Rs.2,500 debited from A/c XX4417 on 30-Aug UPI/P2M/Swiggy. Bal Rs.18,230.",
    "Your OTP for login is 449021. Valid for 10 minutes. Do not share with anyone.",
    "Electricity bill of Rs.1,840 is due on 05-Sep. Pay via the BESCOM app.",
    "Your Flipkart order #OD338 is out for delivery today between 2-4 PM.",
    "Reminder: EMI of Rs.12,400 will be auto-debited on 02-Sep from A/c XX4417.",
    "Dear customer, your monthly statement for Aug is ready in the app.",
    "Salary credited to your account ending 4417. Available balance 62,340.",
    "Your Amazon order has been delivered. Rate your experience in the app.",
    "Movie tickets confirmed. PVR Forum, 7:15 PM, seats G12 G13.",
    "Mom, reached office safely. Will call in the evening.",
    "Hey are we still on for dinner at 8? I'll book the table.",
]

# Kept only to show the gate is working as designed on what it was trained for.
SCAM = [
    "URGENT: Your SBI account is suspended. Update KYC now: http://sbi-verify.tk",
    "You have won Rs.10 lakh in KBC lucky draw. Call 9876543210 to claim.",
    "This is the Income Tax Department. A case is filed against you. Pay immediately.",
]


def main() -> int:
    if not MODEL.exists():
        print(f"missing {MODEL}", file=sys.stderr)
        return 2

    card = json.loads(CARD.read_text())
    threshold = card["threshold_from_validation_only"]
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    tokenizer = AutoTokenizer.from_pretrained(str(TOKENIZER))

    def p_fraud(text: str) -> float:
        enc = tokenizer(text, truncation=True, max_length=64,
                        padding="max_length", return_tensors="np")
        feeds = {i.name: enc[i.name].astype(np.int64)
                 for i in session.get_inputs() if i.name in enc}
        logit = session.run(None, feeds)[0].reshape(-1)[0]
        return float(1 / (1 + np.exp(-logit)))

    rows = []
    false_positives = 0
    print(f"{'P(fraud)':>9}  {'verdict':7} message")
    for text in LEGIT:
        score = p_fraud(text)
        flagged = score >= threshold
        false_positives += flagged
        rows.append({"text": text, "expected": "legit",
                     "p_fraud": round(score, 4), "flagged": bool(flagged)})
        mark = "  <-- FALSE POSITIVE" if flagged else ""
        print(f"{score:9.4f}  {'FRAUD' if flagged else 'legit':7} {text[:52]}{mark}")

    print()
    missed = 0
    for text in SCAM:
        score = p_fraud(text)
        flagged = score >= threshold
        missed += not flagged
        rows.append({"text": text, "expected": "scam",
                     "p_fraud": round(score, 4), "flagged": bool(flagged)})
        print(f"{score:9.4f}  {'FRAUD' if flagged else 'legit':7} {text[:52]}")

    fpr = false_positives / len(LEGIT)
    print(f"\nfalse positives on ordinary legitimate SMS: "
          f"{false_positives}/{len(LEGIT)}  ({fpr:.0%})")
    print(f"scams missed: {missed}/{len(SCAM)}")

    OUT.write_text(json.dumps({
        "probe": "out-of-distribution negative control: Indian transactional SMS",
        "why": "the gate's legitimate class contains no Indian transactional SMS, "
               "while its fraud class is full of Indian smishing, so its own test "
               "split cannot measure this failure",
        "threshold": threshold,
        "legit_false_positive_rate": round(fpr, 4),
        "legit_false_positives": false_positives,
        "legit_total": len(LEGIT),
        "scams_missed": missed,
        "scam_total": len(SCAM),
        "verdict": "DO NOT wire to notificationSuspicion" if fpr > 0.2
                   else "acceptable on this probe",
        "rows": rows,
    }, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(REPO)}")
    return 1 if fpr > 0.2 else 0


if __name__ == "__main__":
    raise SystemExit(main())
