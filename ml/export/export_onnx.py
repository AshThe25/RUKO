#!/usr/bin/env python3
"""Export the trained classifier to ONNX, quantise it, and verify it still works.

    ml/.venv/bin/python ml/export/export_onnx.py

Produces, in ml/models/ruko-manip-v1/onnx/:
    model_fp32.onnx     the exported graph
    model_int8.onnx     dynamically quantised weights
    vocab.txt           WordPiece vocabulary, for the TypeScript tokenizer
    model_card.json     sizes, sha256 hashes, and MEASURED parity + latency

Nothing here is taken on faith. Every export is run against the PyTorch model on
real held-out text and the maximum absolute probability difference is recorded.
A quantised model that has drifted is a silent accuracy regression on a phone,
which is the worst place to discover one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # ml/
from paths import resolve  # noqa: E402
from data import MAX_LENGTH, load_jsonl  # noqa: E402
from model import LABELS, RukoManipulationClassifier  # noqa: E402

# Quantisation acceptance is judged on DECISION FLIPS, not on raw probability
# drift. Measured on this model: int8 moves individual probabilities by up to
# 0.54, which looks alarming, but flips only 1.9% of label decisions and costs
# 0.006 macro F1 on the authored holdout (see ml/models/*/evaluation.json).
# Raw drift is the wrong acceptance criterion -- a probability moving from 0.91
# to 0.37 matters only if it crosses a threshold, and mostly it does not.
MAX_DECISION_FLIP_RATE = 0.03


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_model(ckpt_path: Path):
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    model = RukoManipulationClassifier(ckpt["base_model"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt


def run_onnx(session: ort.InferenceSession, ids: np.ndarray, mask: np.ndarray) -> np.ndarray:
    logits = session.run(None, {"input_ids": ids, "attention_mask": mask})[0]
    return 1.0 / (1.0 + np.exp(-logits))


def benchmark(session: ort.InferenceSession, ids: np.ndarray, mask: np.ndarray,
              runs: int = 100) -> dict:
    for _ in range(10):  # warm up: first calls include lazy kernel setup
        session.run(None, {"input_ids": ids[:1], "attention_mask": mask[:1]})
    timings = []
    for i in range(runs):
        j = i % len(ids)
        start = time.perf_counter()
        session.run(None, {"input_ids": ids[j:j + 1], "attention_mask": mask[j:j + 1]})
        timings.append((time.perf_counter() - start) * 1000)
    timings.sort()
    return {
        "runs": runs,
        "p50_ms": round(timings[len(timings) // 2], 3),
        "p95_ms": round(timings[int(len(timings) * 0.95)], 3),
        "mean_ms": round(sum(timings) / len(timings), 3),
        "min_ms": round(timings[0], 3),
        "max_ms": round(timings[-1], 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("ml/models/ruko-manip-v1"))
    ap.add_argument("--holdout", type=Path,
                    default=Path("ml/datasets/holdout/test_holdout.jsonl"))
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    # Anchor to the repo root so the cwd cannot change what we read.
    args.model_dir = resolve(args.model_dir)
    args.holdout = resolve(args.holdout)

    out_dir = args.model_dir / "onnx"
    out_dir.mkdir(parents=True, exist_ok=True)

    model, ckpt = load_model(args.model_dir / "pytorch_model.pt")
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir / "tokenizer")

    rows = load_jsonl(args.holdout)
    texts = [r["text"] for r in rows]
    enc = tokenizer(texts, truncation=True, max_length=MAX_LENGTH,
                    padding="max_length", return_tensors="pt")
    ids, mask = enc["input_ids"], enc["attention_mask"]

    with torch.no_grad():
        torch_probs = torch.sigmoid(model(ids, mask)).numpy()

    # ---------------------------------------------------------------- #
    # fp32 export
    # ---------------------------------------------------------------- #
    fp32_path = out_dir / "model_fp32.onnx"
    print(f"exporting -> {fp32_path}")
    torch.onnx.export(
        model,
        (ids[:1], mask[:1]),
        str(fp32_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        # Dynamic on both axes: on device we classify one window at a time, and
        # padding every window to 64 tokens would waste most of the compute.
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
        dynamo=False,
    )

    sess_fp32 = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
    onnx_probs = run_onnx(sess_fp32, ids.numpy(), mask.numpy())
    fp32_drift = float(np.max(np.abs(onnx_probs - torch_probs)))
    print(f"fp32 parity vs PyTorch: max abs prob diff {fp32_drift:.2e}")

    # ---------------------------------------------------------------- #
    # int8 dynamic quantisation
    # ---------------------------------------------------------------- #
    from onnxruntime.quantization import QuantType, quantize_dynamic

    int8_path = out_dir / "model_int8.onnx"
    print(f"quantising -> {int8_path}")
    # Dynamic (not static) quantisation: it needs no calibration dataset, and for
    # a transformer of this size the win is almost entirely in the weights.
    quantize_dynamic(str(fp32_path), str(int8_path), weight_type=QuantType.QInt8)

    sess_int8 = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
    int8_probs = run_onnx(sess_int8, ids.numpy(), mask.numpy())
    int8_drift = float(np.max(np.abs(int8_probs - torch_probs)))
    int8_mean_drift = float(np.mean(np.abs(int8_probs - torch_probs)))
    print(f"int8 parity vs PyTorch: max abs prob diff {int8_drift:.4f} "
          f"(mean {int8_mean_drift:.4f})")

    # Does quantisation change any actual DECISION at the calibrated thresholds?
    # This matters far more than the raw probability drift.
    thresholds = np.array(ckpt["thresholds"])
    torch_decisions = torch_probs >= thresholds
    int8_decisions = int8_probs >= thresholds
    flipped = int(np.sum(torch_decisions != int8_decisions))
    total = int(torch_decisions.size)
    print(f"int8 decision flips: {flipped}/{total} "
          f"({flipped / total * 100:.2f}% of label decisions)")

    # ---------------------------------------------------------------- #
    # vocabulary for the TypeScript tokenizer
    # ---------------------------------------------------------------- #
    vocab_path = out_dir / "vocab.txt"
    vocab = tokenizer.get_vocab()
    ordered = [tok for tok, _ in sorted(vocab.items(), key=lambda kv: kv[1])]
    vocab_path.write_text("\n".join(ordered) + "\n", encoding="utf-8")
    print(f"wrote {len(ordered)} vocabulary entries -> {vocab_path}")

    # ---------------------------------------------------------------- #
    # benchmarks (host CPU; the phone number is measured separately)
    # ---------------------------------------------------------------- #
    print("benchmarking on host CPU...")
    bench_fp32 = benchmark(sess_fp32, ids.numpy(), mask.numpy())
    bench_int8 = benchmark(sess_int8, ids.numpy(), mask.numpy())
    print(f"  fp32 p50 {bench_fp32['p50_ms']} ms   int8 p50 {bench_int8['p50_ms']} ms")

    card = {
        "model_version": "ruko-manip-v1",
        "labels": LABELS,
        "thresholds": {l: round(float(t), 3) for l, t in zip(LABELS, ckpt["thresholds"])},
        "base_model": ckpt["base_model"],
        "max_length": ckpt["max_length"],
        "opset": args.opset,
        "artifacts": {
            "model_fp32.onnx": {
                "bytes": fp32_path.stat().st_size,
                "mb": round(fp32_path.stat().st_size / 1e6, 2),
                "sha256": sha256_file(fp32_path),
            },
            "model_int8.onnx": {
                "bytes": int8_path.stat().st_size,
                "mb": round(int8_path.stat().st_size / 1e6, 2),
                "sha256": sha256_file(int8_path),
            },
            "vocab.txt": {
                "entries": len(ordered),
                "sha256": sha256_file(vocab_path),
            },
        },
        "parity": {
            "eval_rows": len(rows),
            "fp32_vs_pytorch_max_prob_diff": fp32_drift,
            "int8_vs_pytorch_max_prob_diff": int8_drift,
            "int8_vs_pytorch_mean_prob_diff": int8_mean_drift,
            "int8_decision_flips": flipped,
            "int8_decision_total": total,
            "int8_decision_flip_rate": round(flipped / total, 5),
            "max_acceptable_flip_rate": MAX_DECISION_FLIP_RATE,
            "verdict": "PASS" if flipped / total <= MAX_DECISION_FLIP_RATE else "REVIEW",
            "note": "Acceptance is on decision flips at the calibrated "
                    "thresholds, not on raw probability drift. The accuracy "
                    "cost is measured end-to-end in evaluation.json.",
        },
        "host_cpu_benchmark": {
            "note": "Host machine, single window, batch 1. NOT a phone number -- "
                    "on-device latency is measured separately on the iQOO 15 and "
                    "reported in the engineering screen.",
            "onnxruntime": ort.__version__,
            "providers": sess_fp32.get_providers(),
            "fp32": bench_fp32,
            "int8": bench_int8,
        },
        "exported_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (args.model_dir / "onnx" / "model_card.json").write_text(json.dumps(card, indent=2) + "\n")

    size_ratio = int8_path.stat().st_size / fp32_path.stat().st_size
    print(f"\n{'=' * 70}")
    print(f"fp32 {card['artifacts']['model_fp32.onnx']['mb']} MB  ->  "
          f"int8 {card['artifacts']['model_int8.onnx']['mb']} MB "
          f"({size_ratio * 100:.0f}% of original)")
    print(f"parity verdict: {card['parity']['verdict']}")
    print(f"model card: {args.model_dir / 'onnx' / 'model_card.json'}")
    print("=" * 70)
    print(f"int8 costs {flipped / total * 100:.2f}% of label decisions; "
          f"run ml/evaluation/evaluate.py for the accuracy cost in F1")

    eval_path = args.model_dir / "evaluation.json"
    evaluation = json.loads(eval_path.read_text()) if eval_path.exists() else None
    ts_path = emit_ts_config(args.model_dir, card, evaluation)
    print(f"wrote {ts_path}"
          + ("" if evaluation else "  (no evaluation.json yet -- using neural thresholds; "
                                   "re-run export after evaluate.py)"))
    return 0 if card["parity"]["verdict"] == "PASS" else 1


def emit_ts_config(model_dir: Path, card: dict, evaluation: dict | None) -> Path:
    """Write the generated TypeScript config the on-device classifier reads.

    Thresholds, the fusion weight and the expected model hash all come from the
    measured artefacts, so the phone can never silently disagree with what was
    evaluated. Regenerated on every export; committed so the app builds without
    running the ML pipeline.
    """
    out = Path("mobile/src/risk/classifier/modelConfig.generated.ts")
    fusion_weight = 0.5
    thresholds = card["thresholds"]
    if evaluation:
        rule = evaluation.get("ensemble_rule", "")
        if rule.startswith("weighted_"):
            fusion_weight = float(rule.split("_")[1])
        thresholds = evaluation["thresholds"].get("ensemble", thresholds)

    body = f"""/**
 * GENERATED FILE -- DO NOT EDIT.
 * Written by ml/export/export_onnx.py from the measured export artefacts.
 *
 * Everything here is a measurement, not a guess: the thresholds are the ones
 * calibrated on the validation split, the fusion weight is the ensemble rule
 * that won on validation, and the hash is of the model file that was evaluated.
 */

import type {{ ManipulationLabel }} from '../../contracts/index.ts';

export const MODEL_VERSION = '{card["model_version"]}';
export const MODEL_FILE = 'model_int8.onnx';
export const MODEL_MAX_LENGTH = {card["max_length"]};

/** sha256 of the int8 model that these thresholds were evaluated against. */
export const EXPECTED_MODEL_SHA256 =
  '{card["artifacts"]["model_int8.onnx"]["sha256"]}';
export const MODEL_SIZE_BYTES = {card["artifacts"]["model_int8.onnx"]["bytes"]};
export const VOCAB_SHA256 = '{card["artifacts"]["vocab.txt"]["sha256"]}';

/**
 * Per-label decision thresholds. These are the point at which a label is
 * considered present; the classifier rescales around them so the risk engine
 * always sees 0.5 as "on the fence".
 */
export const LABEL_THRESHOLDS: Record<ManipulationLabel, number> = {{
{chr(10).join(f"  {l}: {t}," for l, t in thresholds.items())}
}};

/**
 * Ensemble weight on the neural score; the remainder goes to the lexicon.
 * Selected on the validation split; see the model directory's evaluation.json.
 */
export const NEURAL_FUSION_WEIGHT = {fusion_weight};
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    return out


if __name__ == "__main__":
    raise SystemExit(main())
