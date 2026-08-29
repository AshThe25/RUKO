#!/usr/bin/env python3
"""Import external scam-call corpora and weak-label them into Ruko's 6 tactics.

    python3 ml/datasets/import_external.py

WHY: our own generator is the only source of training text, so the model learns
its style. Five separate template expansions all raised the generated-test F1
and left the authored holdout flat inside seed noise (spread 0.041 over five
seeds) — the signature of style overfitting, not of a data shortage.

These corpora are still synthetic, but they were written by a different model
(Llama-3-70B) with different phrasing habits. That is the property we need: a
second style, so the classifier cannot pass by memorising ours.

THE LABEL PROBLEM AND HOW IT IS HANDLED
They carry one binary label, scam / not-scam. They do not have our six tactics,
so they cannot supervise them directly. We weak-label instead: the shipped
lexicon (mobile/src/risk/classifier/lexicon.ts) is ported here and run over the
suspect's turns.

This is deliberately conservative, and the limits are real:
  - A weak label is only kept on rows the corpus already marks as scam, so the
    lexicon cannot invent a tactic inside an ordinary conversation.
  - Non-scam rows become all-zero negatives, which is the half of this corpus
    we trust most and the half our own data has least of.
  - The lexicon has known blind spots. Anything it cannot see stays unlabelled,
    so this corpus can only ever teach the model what the lexicon already
    knows, phrased differently. That is worth having — phrasing is exactly the
    axis we are failing on — but it is not new tactic knowledge, and it must
    never be described as such.

The authored holdout stays the only honest score. Nothing here touches it.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import ML_DIR, REPO_ROOT  # noqa: E402

LABELS = ["authority", "coercion", "urgency", "financialInstruction",
          "secrecy", "credentialRequest"]

LEXICON_TS = REPO_ROOT / "mobile" / "src" / "risk" / "classifier" / "lexicon.ts"

# Only a pattern at least this strong contributes a weak label. The lexicon's
# weaker cues (w<0.7) fire on ordinary speech often enough that using them here
# would inject noise rather than signal.
MIN_WEIGHT = 0.7


def load_lexicon() -> tuple[dict[str, list[re.Pattern]], list[re.Pattern]]:
    """Port the shipped TypeScript lexicon into Python regexes.

    Read, never edited — mobile/ is owned by someone else. The subset of regex
    syntax used there (\\b, bounded .{0,n}, alternation) is identical in both
    languages, so the port is literal.
    """
    src = LEXICON_TS.read_text()

    benign_block = re.search(r"BENIGN_CONTEXT: RegExp\[\] = \[(.*?)\n\];", src, re.S)
    benign = [re.compile(m, re.I) for m in re.findall(r"/(.+?)/,", benign_block.group(1))]

    patterns: dict[str, list[re.Pattern]] = {}
    for label in LABELS:
        block = re.search(rf"\n  {label}: \[(.*?)\n  \],", src, re.S)
        if not block:
            patterns[label] = []
            continue
        entries = re.findall(r"\{ re: /(.+?)/, w: ([0-9.]+) \}", block.group(1))
        patterns[label] = [re.compile(p, re.I) for p, w in entries if float(w) >= MIN_WEIGHT]
    return patterns, benign


def suspect_turns(dialogue: str) -> list[str]:
    """Keep only what the caller says. The victim's replies are not the signal."""
    parts = re.split(r"(?=\b(?:Suspect|Innocent|Scammer|Victim|Caller|Receiver)\s*:)", dialogue)
    return [re.sub(r"^\s*(Suspect|Scammer|Caller)\s*:\s*", "", p).strip()
            for p in parts if re.match(r"^\s*(Suspect|Scammer|Caller)\s*:", p)]


def window(text: str, max_words: int = 60) -> str:
    """Trim to roughly the 64-token window the model actually sees."""
    words = re.sub(r"\s+", " ", text).strip().lower()
    return " ".join(words.split()[:max_words])


def main() -> int:
    try:
        from datasets import load_dataset
    except ImportError:
        print("pip install datasets", file=sys.stderr)
        return 1

    patterns, benign = load_lexicon()
    print(f"lexicon: {sum(len(v) for v in patterns.values())} strong patterns, "
          f"{len(benign)} benign-context guards")

    rows, seen = [], set()
    for name in ("BothBosu/multi-agent-scam-conversation",
                 "BothBosu/single-agent-scam-conversations"):
        for split in ("train", "test"):
            try:
                ds = load_dataset(name, split=split)
            except Exception as exc:  # noqa: BLE001
                print(f"  skip {name}/{split}: {exc}", file=sys.stderr)
                continue

            for item in ds:
                is_scam = int(item.get("labels", 0)) == 1
                for turn in suspect_turns(item.get("dialogue", "")):
                    text = window(turn)
                    if len(text.split()) < 4 or text in seen:
                        continue

                    labels = {lab: 0 for lab in LABELS}
                    if is_scam and not any(b.search(text) for b in benign):
                        for lab, pats in patterns.items():
                            if any(p.search(text) for p in pats):
                                labels[lab] = 1
                        # A scam turn the lexicon cannot read tells us nothing.
                        # Keeping it as all-zero would teach the model that
                        # genuine scam phrasing is safe.
                        if not any(labels.values()):
                            continue

                    seen.add(text)
                    rows.append({
                        "id": f"ext-{len(rows):05d}",
                        "text": text,
                        "labels": labels,
                        "families": [f"external:{name.split('/')[-1]}"],
                        "lang": "en",
                        "kind": "scam" if is_scam else "safe",
                        "n_utterances": 1,
                        "source": f"external:{name}",
                        "split": "external",
                    })

    out = ML_DIR / "data" / "processed" / "external.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    pos = sum(1 for r in rows if any(r["labels"].values()))
    print(f"\n{len(rows)} rows  {pos} weak-labelled positive  {len(rows) - pos} negative")
    for lab in LABELS:
        print(f"  {lab:22s}{sum(r['labels'][lab] for r in rows):5d}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# ---------------------------------------------------------------------------
# MEASURED RESULT (2026-08-30) — this did NOT help, and it is kept anyway.
#
#   baseline, seed 44                 holdout 0.618
#   + 1,716 weak-labelled positives
#     and 1,500 negatives, seed 44    holdout 0.573
#
# Same seed, so the 0.045 drop is not seed noise, though it is about the size
# of the seed band (0.041 across five seeds) and should not be over-read either.
#
# WHY IT DID NOT WORK, as far as the evidence goes:
#   1. The weak labels inherit the lexicon's coverage exactly. urgency got 814
#      positives and secrecy 23 — a distribution nothing like the real one, so
#      the model was pulled toward whatever the lexicon happens to match well.
#   2. The corpus is entirely English. Roughly 40% of our own data is romanised
#      Hinglish, and 1,500 English negatives dilute that.
#   3. Weak labels cannot teach a tactic the lexicon cannot already see, so the
#      one thing we actually need — new tactic knowledge — is the one thing
#      this cannot supply.
#
# Kept because the pipeline is correct and cheap to re-run: the moment there is
# a corpus with real 6-tactic labels, or a Hinglish one, this is the path in.
# Do not enable it in training without re-measuring.
# ---------------------------------------------------------------------------
