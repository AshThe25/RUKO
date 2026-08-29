#!/usr/bin/env python3
"""Import MentalManip (ACL 2024) — real human dialogue, honestly mapped.

    python3 ml/datasets/import_mentalmanip.py

WHY THIS ONE IS DIFFERENT: every other corpus we tried was machine-generated,
so it could not fix the problem we actually have — the classifier learning our
generator's writing style. MentalManip is drawn from the Cornell Movie Dialogs
Corpus: written by people, for people, with none of our phrasing habits.

WHAT IT CAN AND CANNOT SUPPLY. Its 11-technique taxonomy is about interpersonal
manipulation, not fraud, so most of it does not correspond to a Ruko tactic and
is deliberately dropped:

    Intimidation        -> coercion    threat of harm; the same structure as
    Brandishing Anger   -> coercion    "your account will be frozen"

    Persuasion/Seduction, Shaming, Accusation, Rationalization, Denial,
    Evasion, Playing Victim/Servant, Feigning Innocence
                        -> DROPPED. Real manipulation, but not tactics Ruko
                           scores, and forcing them onto `coercion` would
                           teach the model that ordinary hostility is fraud.

Nothing here maps to authority, financialInstruction or credentialRequest —
movie characters do not ask for OTPs — so those labels get no help from this
corpus and we do not pretend otherwise.

THE REAL PRIZE IS THE NEGATIVES. Non-manipulative rows become all-zero examples
of genuine human conversation, which is the single thing our training set has
none of. If this corpus helps, that is the most likely reason.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import ML_DIR  # noqa: E402

LABELS = ["authority", "coercion", "urgency", "financialInstruction",
          "secrecy", "credentialRequest"]

# Only techniques whose *structure* matches a Ruko tactic. Conservative on
# purpose: a wrong positive here is worse than a missing one.
TECHNIQUE_MAP = {
    "Intimidation": "coercion",
    "Brandishing Anger": "coercion",
}

SPEAKER = re.compile(r"^\s*Person\d\s*:\s*", re.I)


def turns(dialogue: str) -> list[str]:
    out = []
    for line in dialogue.splitlines():
        line = SPEAKER.sub("", line).strip()
        line = re.sub(r"\s+", " ", line).lower()
        if 4 <= len(line.split()) <= 60:
            out.append(line)
    return out


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/mm/mentalmanip_dataset/mentalmanip_maj.csv")
    if not src.is_file():
        print(f"missing {src}; clone https://github.com/audreycs/MentalManip", file=sys.stderr)
        return 1

    rows, seen = [], set()
    csv.field_size_limit(10_000_000)
    for rec in csv.DictReader(src.open(encoding="utf-8")):
        manipulative = str(rec.get("Manipulative", "")).strip() == "1"
        techniques = {t.strip() for t in str(rec.get("Technique", "")).split(",") if t.strip()}
        mapped = {TECHNIQUE_MAP[t] for t in techniques if t in TECHNIQUE_MAP}

        # A manipulative dialogue whose techniques we do not map is skipped
        # entirely. Labelling it all-zero would teach the model that real
        # manipulation is benign.
        if manipulative and not mapped:
            continue

        for turn in turns(rec.get("Dialogue", "")):
            if turn in seen:
                continue
            seen.add(turn)
            labels = {lab: 0 for lab in LABELS}
            for lab in mapped:
                labels[lab] = 1
            rows.append({
                "id": f"mm-{len(rows):05d}",
                "text": turn,
                "labels": labels,
                "families": ["external:mentalmanip"],
                "lang": "en",
                "kind": "scam" if manipulative else "safe",
                "n_utterances": 1,
                "source": "external:MentalManip(ACL2024,CC-BY)",
                "split": "external",
            })

    out = ML_DIR / "data" / "processed" / "mentalmanip.jsonl"
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    pos = sum(1 for r in rows if any(r["labels"].values()))
    print(f"{len(rows)} turns  {pos} coercion-positive  {len(rows)-pos} human negatives")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# ---------------------------------------------------------------------------
# MEASURED RESULT (2026-08-30) — did not beat the baseline. Not enabled.
#
#   baseline, seed 44                        holdout 0.618
#   + 1,200 coercion positives
#     and 1,800 human negatives, seed 44     holdout 0.597
#
# Within the seed band (0.041 across five seeds), so this is "no effect"
# rather than "harmful" — but it is not the gain we needed either.
#
# Best guess at why: the corpus only supplies `coercion`, so five of six
# labels get nothing from it, and macro F1 averages over all six. Movie
# characters intimidate each other; they do not impersonate banks or ask for
# OTPs. Real dialogue was the right idea, but this is the wrong domain.
#
# What would actually work is the same shape of corpus in the *fraud* domain,
# which does not exist publicly: real scam-call transcripts are crime evidence
# containing victim PII. That is the honest reason this project's training data
# is synthetic, and it is worth stating plainly rather than apologising for.
#
# Kept because the mapping is conservative and documented, and because the
# next person will otherwise try this exact experiment again.
# ---------------------------------------------------------------------------
