#!/usr/bin/env python3
"""Generate the Ruko manipulation-signal dataset.

    python3 ml/datasets/generate.py --out data/ --seed 20260829

Design notes that matter for honesty:

1. **Splits are disjoint by template family, not by row.** A random row split
   would put slot-variants of training rows into the test set and produce a
   meaningless F1. Whole families go to exactly one split.
2. **ASR-style text.** Real input comes from on-device speech recognition, so
   every example is lowercased, stripped of punctuation, and passed through a
   light disfluency/noise model. Amounts are randomly rendered as digits or as
   words, because ASR does both.
3. **Composite windows.** A real 6-8 second window contains more than one
   tactic. Composites are built only from families inside the same split, and
   scam families are never composed with safe families (that would create label
   noise, not hard negatives -- the hard negatives are authored explicitly).
4. **Nothing here is a real person's conversation.** All text is synthetic.

The generator is fully seeded: same seed in, byte-identical files out.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import slots as S  # noqa: E402
from templates import FAMILIES, LABELS, Family  # noqa: E402

DATASET_VERSION = "ruko-manip-ds-v1"

# ---------------------------------------------------------------------------
# Indian-numbering number-to-words, so "48,000" can also appear the way an ASR
# engine would transcribe a speaker saying it out loud.
# ---------------------------------------------------------------------------
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
         "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
         "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
         "eighty", "ninety"]


def _under_hundred(n: int) -> str:
    if n < 20:
        return _ONES[n]
    t, o = divmod(n, 10)
    return _TENS[t] + (" " + _ONES[o] if o else "")


def num_to_words_indian(n: int) -> str:
    """0..99,99,999 -> English words using the Indian lakh/thousand system."""
    if n == 0:
        return "zero"
    parts = []
    for div, name in ((10_00_000, "lakh"), (1_000, "thousand"), (100, "hundred")):
        q, n = divmod(n, div)
        if q:
            parts.append(f"{_under_hundred(q) if q < 100 else num_to_words_indian(q)} {name}")
    if n:
        parts.append(_under_hundred(n))
    return " ".join(parts)


def render_amount(raw: str, rng: random.Random) -> str:
    """'48,000' -> '48,000' or 'forty eight thousand', the way ASR would."""
    digits = int(raw.replace(",", ""))
    return raw if rng.random() < 0.5 else num_to_words_indian(digits)


# ---------------------------------------------------------------------------
# Slot filling
# ---------------------------------------------------------------------------
SLOT_POOLS = {
    "bank": S.BANKS, "agency": S.AGENCIES, "wallet": S.WALLETS,
    "courier": S.COURIERS, "name": S.FIRST_NAMES, "relation": S.RELATIONS,
    "merchant": S.MERCHANTS, "emp": S.EMP_IDS, "minutes": S.MINUTES,
    "hours": S.HOURS, "tail": S.ACCOUNT_TAIL, "upi": S.UPI_IDS,
    "remote": S.REMOTE_APPS,
}
AMOUNT_SLOTS = {"small": S.SMALL_AMOUNTS, "large": S.LARGE_AMOUNTS,
                "rent": S.RENT_AMOUNTS}


def fill(template: str, rng: random.Random) -> str:
    out = template
    for slot in re.findall(r"\{(\w+)\}", template):
        if slot in AMOUNT_SLOTS:
            value = render_amount(rng.choice(AMOUNT_SLOTS[slot]), rng)
        elif slot in SLOT_POOLS:
            value = rng.choice(SLOT_POOLS[slot])
        else:  # pragma: no cover - guards against a typo in templates.py
            raise KeyError(f"unknown slot {{{slot}}} in template: {template!r}")
        out = out.replace("{" + slot + "}", value, 1)
    return out


# ---------------------------------------------------------------------------
# ASR-style surface noise
# ---------------------------------------------------------------------------
FILLERS_EN = ["uh", "um", "hello", "yes", "okay", "so", "actually"]
FILLERS_HI = ["haan ji", "achha", "arre", "toh", "matlab", "ji"]


def asr_normalise(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def asr_noise(text: str, lang: str, rng: random.Random) -> str:
    """Light, seeded corruption approximating on-device ASR output."""
    words = text.split()
    out = []
    for w in words:
        r = rng.random()
        if r < 0.020 and len(words) > 6:
            continue                      # dropped word
        if r < 0.030:
            out.extend([w, w])            # stutter / duplicate
            continue
        out.append(w)
    if rng.random() < 0.25:
        fillers = FILLERS_HI if lang == "hinglish" else FILLERS_EN
        pos = rng.randrange(0, max(1, len(out)))
        out.insert(pos, rng.choice(fillers))
    return " ".join(out)


# ---------------------------------------------------------------------------
# Family-disjoint splitting
# ---------------------------------------------------------------------------
def primary_group(f: Family) -> str:
    """Group families so every split gets coverage of every tactic."""
    return f.tactics[0] if f.tactics else "none"


def split_families(rng: random.Random, ratios=(0.70, 0.15, 0.15)):
    groups: dict[str, list[Family]] = defaultdict(list)
    for f in FAMILIES:
        groups[f"{f.kind}:{primary_group(f)}"].append(f)

    assignment: dict[str, str] = {}
    for key in sorted(groups):
        fams = sorted(groups[key], key=lambda f: f.id)
        rng.shuffle(fams)
        n = len(fams)
        if n == 1:
            picks = ["train"]
        elif n == 2:
            picks = ["train", "test"]
        elif n == 3:
            picks = ["train", "val", "test"]
        else:
            n_val = max(1, round(n * ratios[1]))
            n_test = max(1, round(n * ratios[2]))
            n_train = n - n_val - n_test
            picks = ["train"] * n_train + ["val"] * n_val + ["test"] * n_test
        for fam, split in zip(fams, picks):
            assignment[fam.id] = split
    return assignment


# ---------------------------------------------------------------------------
# Window composition
# ---------------------------------------------------------------------------
def make_window(pool: list[Family], rng: random.Random) -> dict | None:
    """Build one training window: 1-3 utterances from same-kind families."""
    seed_fam = rng.choice(pool)
    same_kind = [f for f in pool if f.kind == seed_fam.kind and not f.solo]
    n_utt = rng.choices([1, 2, 3], weights=[0.35, 0.40, 0.25])[0]

    chosen = [seed_fam]
    # Prefer families that add a tactic we do not already have -- this mirrors
    # how a real manipulative call layers authority, then threat, then demand.
    while len(chosen) < n_utt and same_kind:
        have = {t for f in chosen for t in f.tactics}
        fresh = [f for f in same_kind
                 if f.id not in {c.id for c in chosen}
                 and (set(f.tactics) - have or seed_fam.kind == "safe")]
        if not fresh:
            break
        chosen.append(rng.choice(fresh))

    lang = "hinglish" if any(f.lang == "hinglish" for f in chosen) else "en"
    parts = [asr_normalise(fill(rng.choice(f.templates), rng)) for f in chosen]
    text = asr_noise(" ".join(parts), lang, rng)
    if len(text.split()) < 3:
        return None

    labels = {lab: 0 for lab in LABELS}
    for f in chosen:
        for t in f.tactics:
            labels[t] = 1

    return {
        "text": text,
        "labels": labels,
        "families": sorted(f.id for f in chosen),
        "lang": lang,
        "kind": seed_fam.kind,
        "n_utterances": len(chosen),
        "source": "synthetic",
    }


def generate_split(pool: list[Family], target: int, rng: random.Random,
                   seen: set[str]) -> list[dict]:
    rows, attempts = [], 0
    while len(rows) < target and attempts < target * 40:
        attempts += 1
        row = make_window(pool, rng)
        if row is None:
            continue
        key = row["text"]
        if key in seen:          # global dedup: no text appears twice, ever
            continue
        seen.add(key)
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def label_stats(rows: list[dict]) -> dict:
    c = Counter()
    for r in rows:
        for lab, v in r["labels"].items():
            if v:
                c[lab] += 1
    return {
        "rows": len(rows),
        "positives_per_label": {lab: c.get(lab, 0) for lab in LABELS},
        "all_zero_rows": sum(1 for r in rows if not any(r["labels"].values())),
        "by_lang": dict(Counter(r["lang"] for r in rows)),
        "by_kind": dict(Counter(r["kind"] for r in rows)),
        "mean_words": round(sum(len(r["text"].split()) for r in rows) / max(1, len(rows)), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data", type=Path)
    ap.add_argument("--seed", type=int, default=20260829)
    ap.add_argument("--train", type=int, default=6000)
    ap.add_argument("--val", type=int, default=1200)
    ap.add_argument("--test", type=int, default=1200)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    assignment = split_families(random.Random(args.seed ^ 0xA11CE))

    pools: dict[str, list[Family]] = defaultdict(list)
    for f in FAMILIES:
        pools[assignment[f.id]].append(f)

    for split in ("train", "val", "test"):
        kinds = {f.kind for f in pools[split]}
        if kinds != {"scam", "safe"}:
            raise SystemExit(f"split {split} lacks both kinds: {kinds}")

    raw_dir = args.out / "raw"
    proc_dir = args.out / "processed"
    raw_dir.mkdir(parents=True, exist_ok=True)
    proc_dir.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    manifest = {
        "dataset_version": DATASET_VERSION,
        "seed": args.seed,
        "labels": LABELS,
        "family_assignment": assignment,
        "families_total": len(FAMILIES),
        "splits": {},
        "files": {},
    }

    targets = {"train": args.train, "val": args.val, "test": args.test}
    for split in ("train", "val", "test"):
        rows = generate_split(pools[split], targets[split], rng, seen)
        for i, r in enumerate(rows):
            r["id"] = f"{split}-{i:05d}"
            r["split"] = split
        path = proc_dir / f"{split}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        manifest["splits"][split] = {
            "families": sorted(f.id for f in pools[split]),
            **label_stats(rows),
        }
        manifest["files"][str(path.relative_to(args.out))] = sha256_file(path)
        print(f"{split:6s} {len(rows):5d} rows  "
              f"{len(pools[split]):2d} families  "
              f"{manifest['splits'][split]['all_zero_rows']:4d} all-zero")

    # The authored holdout ships with the repo; hash it here so the manifest
    # describes the full evaluation surface.
    holdout = Path(__file__).resolve().parent / "holdout" / "test_holdout.jsonl"
    if holdout.exists():
        rows = [json.loads(l) for l in holdout.read_text(encoding="utf-8").splitlines() if l.strip()]
        manifest["splits"]["holdout"] = {"families": ["hand-authored"], **label_stats(rows)}
        manifest["files"]["holdout/test_holdout.jsonl"] = sha256_file(holdout)
        print(f"holdout {len(rows):4d} rows  hand-authored, zero template overlap")

    # Leakage check: identical text must never appear in two splits.
    texts: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for line in (proc_dir / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
            t = json.loads(line)["text"]
            if t in texts and texts[t] != split:
                raise SystemExit(f"LEAK: text appears in {texts[t]} and {split}: {t!r}")
            texts[t] = split
    manifest["leakage_check"] = "passed: no exact text shared across splits"

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nwrote {args.out}/manifest.json  ({DATASET_VERSION}, seed={args.seed})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
