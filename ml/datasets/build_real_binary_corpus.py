#!/usr/bin/env python3
"""Build Ruko's all-real fraud-vs-legitimate call corpus.

There are deliberately no templates, LLM generations, or synthetic examples in
this pipeline.

Positive source
---------------
NCSU Robocall Audio Dataset, containing real-world robocall audio and Whisper
transcripts published from US FTC Project Point of No Entry evidence.  The FTC
enforcement context supplies a *suspected illegal robocall* label, not a
per-call court finding.

Negative source
---------------
CallCenterEN (AIxBlock), real PII-redacted English BPO customer-service call
transcripts.  The data card is CC BY-NC 4.0 and permits research/model work;
do not redistribute its raw transcript data.

The corpus is for a binary fraud gate.  It must not be presented as a six-
tactic ground-truth dataset: public real call corpora do not supply those
annotations.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

SEED = 20260830
WINDOW_WORDS = 64
WINDOW_STRIDE = 48
MAX_WINDOWS_PER_CALL = 4

FTC_SOURCE = {
    "name": "NCSU Robocall Audio Dataset / FTC Project Point of No Entry",
    "url": "https://github.com/wspr-ncsu/robocall-audio-dataset",
    "licence": "Underlying data public domain; dataset documentation CC BY-ND.",
    "label": "suspected illegal robocall from FTC enforcement evidence",
}
CALLCENTER_SOURCE = {
    "name": "CallCenterEN (AIxBlock)",
    "url": "https://huggingface.co/datasets/AIxBlock/92k-real-world-call-center-scripts-english",
    "licence": "CC BY-NC 4.0; local hackathon/research use only, do not redistribute raw data.",
    "label": "PII-redacted legitimate BPO customer-service call",
}


def normalise(text: str) -> str:
    # CallCenterEN deliberately redacts PII as tokens such as [PERSON_NAME].
    # They are a source-specific publishing artefact, not words a phone ASR
    # system hears.  Remove them so the classifier cannot distinguish sources
    # merely by the redaction convention.
    without_redactions = re.sub(r"\[[A-Z][A-Z0-9_]{1,}\]", " ", text)
    return re.sub(r"\s+", " ", without_redactions.replace("\x00", " ")).strip()


def digest(text: str) -> str:
    return hashlib.sha256(text.lower().encode("utf-8")).hexdigest()


def split_for(group: str) -> str:
    bucket = int(digest(group)[:8], 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def windows(text: str) -> list[str]:
    words = text.split()
    if len(words) < 8:
        return []
    all_windows = [
        " ".join(words[start:start + WINDOW_WORDS])
        for start in range(0, len(words), WINDOW_STRIDE)
        if len(words[start:start + WINDOW_WORDS]) >= 8
    ]
    if len(all_windows) <= MAX_WINDOWS_PER_CALL:
        return all_windows
    # Span a call rather than allowing a single lengthy call to dominate.
    indices = [round(i * (len(all_windows) - 1) / (MAX_WINDOWS_PER_CALL - 1))
               for i in range(MAX_WINDOWS_PER_CALL)]
    return [all_windows[i] for i in sorted(set(indices))]


def add_rows(
    result: dict[str, list[dict]],
    *, source: str, source_id: str, text: str, label: int,
) -> None:
    group = f"{source}:{source_id}"
    split = split_for(group)
    for index, window in enumerate(windows(text)):
        result[split].append({
            "id": f"{source}:{digest(group)}:{index}",
            "text": window,
            "label": label,
            "source": source,
            "source_id": source_id,
            "group": group,
        })


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ftc-csv", required=True, type=Path)
    ap.add_argument("--callcenter-dir", required=True, type=Path)
    ap.add_argument("--out", default=Path("ml/data/real-binary"), type=Path)
    ap.add_argument("--negative-ratio", default=1.0, type=float,
                    help="Maximum CallCenterEN windows per FTC window in each split")
    args = ap.parse_args()
    rng = random.Random(SEED)
    result: dict[str, list[dict]] = {"train": [], "val": [], "test": []}

    # FTC contains repeated robocall scripts.  Deduplicate text before splitting
    # so a script cannot appear on both sides of an evaluation boundary.
    seen_ftc: set[str] = set()
    with args.ftc_csv.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("language", "").lower() != "en":
                continue
            text = normalise(row.get("transcript", ""))
            text_key = digest(text)
            if text_key in seen_ftc:
                continue
            seen_ftc.add(text_key)
            add_rows(result, source="ftc_robocall", source_id=text_key, text=text, label=1)

    # Each JSON is a separate PII-redacted legitimate call.  Files—not 64-word
    # windows—are assigned to splits, eliminating within-call leakage.
    negatives: dict[str, list[dict]] = {"train": [], "val": [], "test": []}
    for transcript_path in sorted(args.callcenter_dir.glob("*.json")):
        try:
            record = json.loads(transcript_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        text = normalise(str(record.get("text", "")))
        before = {split: len(result[split]) for split in result}
        add_rows(negatives, source="callcenteren", source_id=transcript_path.stem,
                 text=text, label=0)
        # Defensive no-op: add_rows writes into a passed mapping only.  Keeping
        # this guard makes accidental future mutation of `result` obvious.
        assert before == {split: len(result[split]) for split in result}

    for split in result:
        positives = len(result[split])
        pool = negatives[split]
        rng.shuffle(pool)
        keep = min(len(pool), max(1, round(positives * args.negative_ratio)))
        result[split].extend(pool[:keep])
        rng.shuffle(result[split])

    args.out.mkdir(parents=True, exist_ok=True)
    summary: dict[str, dict] = {}
    for split, rows in result.items():
        (args.out / f"{split}.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )
        summary[split] = {
            "rows": len(rows),
            "labels": dict(Counter(str(row["label"]) for row in rows)),
            "sources": dict(Counter(row["source"] for row in rows)),
            "unique_groups": len({row["group"] for row in rows}),
        }

    manifest = {
        "dataset_version": "ruko-real-binary-v1",
        "seed": SEED,
        "task": "binary suspected-illegal-robocall versus legitimate-call classification",
        "all_examples_human_origin": True,
        "contains_synthetic_or_llm_generated_examples": False,
        "sources": {"positive": FTC_SOURCE, "negative": CALLCENTER_SOURCE},
        "inputs": {
            "ftc_csv_sha256": sha256(args.ftc_csv),
            "callcenter_files": len(list(args.callcenter_dir.glob("*.json"))),
        },
        "split_policy": (
            "70/15/15 deterministic split at source-call level; exact FTC scripts "
            "deduplicated before splitting; all windows from one call stay together."
        ),
        "windowing": {
            "words": WINDOW_WORDS,
            "stride": WINDOW_STRIDE,
            "maximum_windows_per_call": MAX_WINDOWS_PER_CALL,
        },
        "preprocessing": (
            "Whitespace normalisation and removal of publisher PII-redaction tokens "
            "such as [PERSON_NAME]; no text is generated or paraphrased."
        ),
        "splits": summary,
        "limitations": [
            "FTC labels are enforcement-context suspected-illegal labels, not per-call convictions.",
            "CallCenterEN is English; it does not establish Indian/Hinglish performance.",
            "This is a binary gate, not a six-tactic human-annotated corpus.",
        ],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
