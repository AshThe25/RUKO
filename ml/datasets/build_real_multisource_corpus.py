#!/usr/bin/env python3
"""Build an all-real, multi-source fraud-text corpus for a separate Ruko candidate.

This is intentionally a *binary text safety gate*, not a substitute for the
six-tactic classifier.  It contains only source-provided, human-origin text:

* FTC/NCSU real-world suspected-illegal robocall transcripts (positive)
* NCSU gateway-observed messages marked phishing by VirusTotal/APWG (positive)
* IMC'25 public user-reported smishing, excluding all India-network rows
  (positive)
* PII-redacted BPO customer-service conversations (negative)
* UCI's real legitimate SMS messages (negative)

India-network IMC'25 rows are excluded before any split so they remain a
separate, never-trained-on external stress set.  No templates, translations,
paraphrases, or LLM generations enter this pipeline.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

SEED = 20260830
WINDOW_WORDS = 64
WINDOW_STRIDE = 48
MAX_WINDOWS_PER_CALL = 4
SOURCE_CAPS = {"train": 2200, "val": 450, "test": 450}

SOURCES = {
    "ftc_robocall": {
        "label": 1,
        "kind": "suspected illegal robocall",
        "url": "https://github.com/wspr-ncsu/robocall-audio-dataset",
        "licence": "Underlying data public domain; dataset documentation CC BY-ND.",
    },
    "ncsu_sms_phishing": {
        "label": 1,
        "kind": "gateway-observed SMS marked phishing by VirusTotal/APWG",
        "url": "https://github.com/wspr-ncsu/sms-phishing",
        "licence": "MIT",
    },
    "imc25_non_india_smishing": {
        "label": 1,
        "kind": "public user-reported smishing (all India-network rows held out)",
        "url": "https://github.com/reportsmishing/Smishing-Dataset-IMC25",
        "licence": "CC-BY-4.0",
    },
    "callcenteren": {
        "label": 0,
        "kind": "PII-redacted legitimate BPO customer-service call",
        "url": "https://huggingface.co/datasets/AIxBlock/92k-real-world-call-center-scripts-english",
        "licence": "CC-BY-NC-4.0; local hackathon/research evaluation only.",
    },
    "uci_sms_ham": {
        "label": 0,
        "kind": "real legitimate SMS",
        "url": "https://archive.ics.uci.edu/dataset/228/sms+spam+collection",
        "licence": "CC-BY-4.0",
    },
}


def clean(text: str) -> str:
    # BPO privacy placeholders are publishing artefacts, not spoken words.
    text = re.sub(r"\[[A-Z][A-Z0-9_]{1,}\]", " ", text)
    return re.sub(r"\s+", " ", text.replace("\x00", " ")).strip()


def digest(text: str) -> str:
    return hashlib.sha256(text.lower().encode("utf-8")).hexdigest()


def split_for(group: str) -> str:
    bucket = int(digest(group)[:8], 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def windows(text: str, is_call: bool) -> list[str]:
    words = text.split()
    if len(words) < 8:
        return []
    if not is_call:
        return [" ".join(words[:WINDOW_WORDS])]
    rows = [" ".join(words[start:start + WINDOW_WORDS])
            for start in range(0, len(words), WINDOW_STRIDE)
            if len(words[start:start + WINDOW_WORDS]) >= 8]
    if len(rows) <= MAX_WINDOWS_PER_CALL:
        return rows
    indices = [round(i * (len(rows) - 1) / (MAX_WINDOWS_PER_CALL - 1))
               for i in range(MAX_WINDOWS_PER_CALL)]
    return [rows[index] for index in sorted(set(indices))]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ftc-csv", type=Path, required=True)
    ap.add_argument("--ncsu-sms-csv", type=Path, required=True)
    ap.add_argument("--imc-csv", type=Path, required=True)
    ap.add_argument("--callcenter-dir", type=Path, required=True)
    ap.add_argument("--uci-sms", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("ml/data/real-multisource"))
    args = ap.parse_args()

    # Keep raw records until every source is read.  This lets us discard a
    # text that appears with conflicting labels rather than silently leaking or
    # turning ambiguity into fake ground truth.
    records: list[dict] = []

    with args.ftc_csv.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("language", "").lower() == "en":
                text = clean(row.get("transcript", ""))
                records.append({"source": "ftc_robocall", "source_id": digest(text),
                                "text": text, "call": True})

    with args.ncsu_sms_csv.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            text = clean(row.get("message", ""))
            records.append({"source": "ncsu_sms_phishing", "source_id": row.get("objectID", digest(text)),
                            "text": text, "call": False})

    with args.imc_csv.open(encoding="utf-8", newline="") as fh:
        for row_number, row in enumerate(csv.DictReader(fh)):
            # Critical: this is the untouched India-associated external set.
            if row.get("original_network_country") == "IND":
                continue
            text = clean(row.get("text", ""))  # raw message only, never translation
            records.append({"source": "imc25_non_india_smishing", "source_id": str(row_number),
                            "text": text, "call": False})

    for transcript_path in sorted(args.callcenter_dir.glob("*.json")):
        try:
            row = json.loads(transcript_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        records.append({"source": "callcenteren", "source_id": transcript_path.stem,
                        "text": clean(str(row.get("text", ""))), "call": True})

    with args.uci_sms.open(encoding="utf-8") as fh:
        for line_number, line in enumerate(fh):
            label, separator, text = line.rstrip("\n").partition("\t")
            if separator and label == "ham":
                records.append({"source": "uci_sms_ham", "source_id": str(line_number),
                                "text": clean(text), "call": False})

    label_by_text: dict[str, set[int]] = defaultdict(set)
    for record in records:
        if len(record["text"].split()) >= 8:
            label_by_text[digest(record["text"])].add(SOURCES[record["source"]]["label"])
    conflicted = {key for key, labels in label_by_text.items() if len(labels) > 1}

    # A text appearing in two same-label sources is retained once only.  That
    # protects the held-out split from exact cross-source duplicates as well as
    # avoiding one public report being counted twice.
    seen_text_globally: set[str] = set()
    candidates: dict[str, dict[str, list[dict]]] = {
        split: defaultdict(list) for split in ("train", "val", "test")
    }
    for record in records:
        text_key = digest(record["text"])
        source = record["source"]
        if text_key in conflicted:
            continue
        if text_key in seen_text_globally:
            continue
        seen_text_globally.add(text_key)
        group = f"{source}:{record['source_id']}"
        for index, text in enumerate(windows(record["text"], record["call"])):
            candidates[split_for(group)][source].append({
                "id": f"{source}:{digest(group)}:{index}",
                "text": text,
                "label": SOURCES[source]["label"],
                "source": source,
                "source_id": record["source_id"],
                "group": group,
            })

    result: dict[str, list[dict]] = {split: [] for split in ("train", "val", "test")}
    for split, by_source in candidates.items():
        for source, rows in by_source.items():
            # Stable content-hash ordering makes capping reproducible without
            # a random row split.  Groups were assigned before this cap.
            rows.sort(key=lambda row: digest(f"{SEED}:{row['id']}"))
            result[split].extend(rows[:SOURCE_CAPS[split]])
        result[split].sort(key=lambda row: digest(f"{SEED}:shuffle:{row['id']}"))

    # Different real calls can contain the same boilerplate 64-word fragment.
    # Remove an exact fragment from later splits (rather than letting an
    # encoder see it in training and receive credit for it in evaluation).
    # This does not move a call between splits; it only drops duplicated rows.
    seen_windows: set[str] = set()
    removed_cross_split_windows = 0
    for split in ("train", "val", "test"):
        unique_rows = []
        for row in result[split]:
            text_key = digest(row["text"])
            if text_key in seen_windows:
                removed_cross_split_windows += 1
                continue
            seen_windows.add(text_key)
            unique_rows.append(row)
        result[split] = unique_rows

    args.out.mkdir(parents=True, exist_ok=True)
    split_summary = {}
    for split, rows in result.items():
        (args.out / f"{split}.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        split_summary[split] = {
            "rows": len(rows),
            "labels": dict(Counter(str(row["label"]) for row in rows)),
            "sources": dict(Counter(row["source"] for row in rows)),
            "unique_groups": len({row["group"] for row in rows}),
        }

    manifest = {
        "dataset_version": "ruko-real-multisource-v1",
        "seed": SEED,
        "task": "binary suspected-fraud/manipulation text versus legitimate communication",
        "all_examples_human_origin": True,
        "contains_synthetic_or_llm_generated_examples": False,
        "sources": SOURCES,
        "inputs": {
            "ftc_csv_sha256": sha256(args.ftc_csv),
            "ncsu_sms_csv_sha256": sha256(args.ncsu_sms_csv),
            "imc_csv_sha256": sha256(args.imc_csv),
            "callcenter_files": len(list(args.callcenter_dir.glob("*.json"))),
            "uci_sms_sha256": sha256(args.uci_sms),
        },
        "split_policy": "70/15/15 deterministic source-call/message group split before capping; exact conflicting labels excluded; exact window duplicates removed from later splits.",
        "source_caps_per_split": SOURCE_CAPS,
        "held_out_external_set": "All IMC'25 rows with original_network_country == IND are excluded before corpus construction.",
        "preprocessing": "Whitespace normalisation and removal of source PII-redaction placeholders; no generated or translated text.",
        "split_summary": split_summary,
        "dropped_conflicting_text_hashes": len(conflicted),
        "dropped_exact_cross_split_windows": removed_cross_split_windows,
        "limitations": [
            "This combines real phone-call and SMS text; it is not a pure call-only benchmark.",
            "Fraud labels retain each source's evidence context and are not individual criminal convictions.",
            "It is a binary gate, not a gold six-tactic annotation corpus.",
            "The noncommercial CallCenterEN source makes this a local research/hackathon candidate, not a production distribution artefact.",
        ],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
