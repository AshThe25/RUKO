#!/usr/bin/env python3
"""Build the negative class the fraud gate is missing.

    python3 ml/datasets/build_india_transactional_negatives.py

WHY: ruko-real-multisource-v1 reports precision 0.9953 and yet flags 8 of 11
ordinary Indian SMS as fraud, including a salary credit at 0.998. Its
legitimate class is UCI SMS ham (personal English chat, 2012) and call-centre
transcripts; its fraud class is real Indian smishing. So every message in
training that mentions an account, a rupee amount or an OTP is fraud, and the
model learned "transactional text = fraud". Its own test split shares the gap
and cannot see it.

This is the missing negative control, as data: the boring, legitimate messages
an Indian phone receives every week. Fold these into the legitimate class and
retrain, and the correlation the model is exploiting breaks.

Deliberately synthetic-but-realistic and marked as such. It is a *negative
control*, not a claim about real-world distribution — every row is a message
type anyone in India receives, in the register banks and merchants actually
use. Nothing here is scraped, so nothing here carries a licence or a person.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import resolve  # noqa: E402

SEED = 20260830
OUT = resolve("ml/datasets/holdout/india_transactional_negatives.jsonl")

BANKS = ["SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak", "PNB", "BoB"]
TAILS = ["4417", "8823", "0091", "7734", "2256", "9012"]
MERCHANTS = ["Swiggy", "Zomato", "Amazon", "Flipkart", "BigBasket", "Blinkit",
             "IRCTC", "Myntra", "Uber", "BookMyShow"]
SMALL = ["149", "249", "380", "512", "749", "1,240", "1,899", "2,500"]
BIG = ["12,400", "18,000", "24,750", "32,100", "45,600", "62,340"]
DATES = ["02-Sep", "05-Sep", "11-Sep", "18-Sep", "27-Aug", "30-Aug"]
UTILS = ["BESCOM", "Airtel", "Jio", "Tata Power", "Mahanagar Gas", "BSNL"]

# Every one of these is a message an ordinary phone receives and that the gate
# must NOT call fraud. Kept in the register the senders actually use, including
# the "do not share" boilerplate that real OTP messages carry — that phrase in
# particular reads as fraud to a model trained only on smishing.
TEMPLATES = [
    "Rs.{small} debited from A/c XX{tail} on {date} UPI/P2M/{merchant}. Bal Rs.{big}.",
    "Rs.{small} credited to A/c XX{tail} on {date}. Bal Rs.{big}. -{bank}",
    "Your OTP for login is {otp}. Valid for 10 minutes. Do not share with anyone.",
    "{otp} is your OTP for {merchant} order. Never share this with anyone.",
    "Salary credited to your account ending {tail}. Available balance {big}.",
    "Reminder: EMI of Rs.{big} will be auto-debited on {date} from A/c XX{tail}.",
    "{util} bill of Rs.{small} is due on {date}. Pay via the app to avoid late fee.",
    "Your {merchant} order is out for delivery today between 2-4 PM.",
    "Your {merchant} order has been delivered. Rate your experience in the app.",
    "Dear customer, your monthly statement for A/c XX{tail} is ready in the app.",
    "Recharge of Rs.{small} successful for {util}. Validity 28 days.",
    "Refund of Rs.{small} for your {merchant} order has been initiated to A/c XX{tail}.",
    "Card ending {tail} used for Rs.{small} at {merchant}. Not you? Call {bank}.",
    "Cheque no. 4471 for Rs.{big} has been cleared from A/c XX{tail}.",
    "Your {bank} credit card statement is generated. Total due Rs.{big}, by {date}.",
    "Mini statement: A/c XX{tail}, Bal Rs.{big} as on {date}. -{bank}",
    "Rs.{small} paid to {merchant} via UPI. UPI Ref 4471{tail}.",
    "Your FD of Rs.{big} matures on {date}. Renew from the {bank} app.",
    "NEFT of Rs.{big} credited to A/c XX{tail} from ACME SOLUTIONS PVT LTD.",
    "Autopay set up for {util}. Rs.{small} will be debited every month.",
    "Your {merchant} ticket is confirmed. Booking ID 4471{tail}.",
    "Balance in A/c XX{tail} is Rs.{big}. Thank you for banking with {bank}.",
    "Payment of Rs.{big} received towards Loan A/c XX{tail}. Thank you.",
    "Your {merchant} subscription renews on {date} for Rs.{small}.",
]


def main() -> int:
    rng = random.Random(SEED)
    rows, seen = [], set()

    for template in TEMPLATES:
        for _ in range(4):
            text = (
                template
                .replace("{bank}", rng.choice(BANKS))
                .replace("{tail}", rng.choice(TAILS))
                .replace("{merchant}", rng.choice(MERCHANTS))
                .replace("{small}", rng.choice(SMALL))
                .replace("{big}", rng.choice(BIG))
                .replace("{date}", rng.choice(DATES))
                .replace("{util}", rng.choice(UTILS))
                .replace("{otp}", str(rng.randint(100000, 999999)))
            )
            if text in seen:
                continue
            seen.add(text)
            rows.append({"text": text, "label": 0, "kind": "india_transactional_legit"})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"wrote {len(rows)} legitimate Indian transactional messages")
    print(f"  -> {OUT}")
    print("\nFold into the fraud gate's legitimate class and retrain. Verify with:")
    print("  ml/.venv/bin/python ml/evaluation/probe_fraud_gate_ood.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
