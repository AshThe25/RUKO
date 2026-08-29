#!/usr/bin/env python3
"""Full evaluation: PyTorch vs ONNX fp32 vs ONNX int8 vs lexicon vs ensemble.

    node ml/evaluation/export_heuristic_scores.ts        # first
    ml/.venv/bin/python ml/evaluation/evaluate.py

This answers the four questions that decide what actually ships:

  1. Does the trained model beat the 200-line lexicon by enough to justify
     shipping 23 MB of weights to a phone?
  2. Does int8 quantisation cost accuracy, or only bytes?
  3. Does combining the two beat either alone?
  4. How much of any of this survives contact with text the templates never
     produced?

Methodology guard: the ensemble rule and its weight are selected on the
VALIDATION split. The holdout is scored once, at the end, with that choice
already fixed. Picking the fusion rule by looking at holdout scores would be
exactly the sort of quiet cheating this pipeline exists to avoid.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
from data import MAX_LENGTH, load_jsonl  # noqa: E402
from model import LABELS, RukoManipulationClassifier  # noqa: E402


def prf(pred: np.ndarray, gold: np.ndarray) -> tuple[float, float, float]:
    tp = float((pred & gold).sum())
    fp = float((pred & ~gold).sum())
    fn = float((~pred & gold).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def summarise(probs: np.ndarray, gold: np.ndarray, thresholds: np.ndarray) -> dict:
    per_label, f1s = {}, []
    tp = fp = fn = 0
    for i, label in enumerate(LABELS):
        pred = probs[:, i] >= thresholds[i]
        g = gold[:, i].astype(bool)
        p, r, f = prf(pred, g)
        f1s.append(f)
        tp += int((pred & g).sum()); fp += int((pred & ~g).sum()); fn += int((~pred & g).sum())
        per_label[label] = {
            "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "tp": int((pred & g).sum()), "fp": int((pred & ~g).sum()),
            "fn": int((~pred & g).sum()), "tn": int((~pred & ~g).sum()),
        }
    mp = tp / max(1, tp + fp)
    mr = tp / max(1, tp + fn)
    return {
        "macro_f1": round(float(np.mean(f1s)), 4),
        "micro_precision": round(mp, 4),
        "micro_recall": round(mr, 4),
        "micro_f1": round(2 * mp * mr / max(1e-9, mp + mr), 4),
        "exact_match": round(float(((probs >= thresholds) == gold.astype(bool)).all(axis=1).mean()), 4),
        "per_label": per_label,
    }


def confusion_matrices(probs, gold, thresholds) -> dict:
    """Per-label 2x2 confusion matrix. Multi-label has no single NxN matrix."""
    out = {}
    for i, label in enumerate(LABELS):
        pred = probs[:, i] >= thresholds[i]
        g = gold[:, i].astype(bool)
        out[label] = {
            "predicted_positive": {"actual_positive": int((pred & g).sum()),
                                   "actual_negative": int((pred & ~g).sum())},
            "predicted_negative": {"actual_positive": int((~pred & g).sum()),
                                   "actual_negative": int((~pred & ~g).sum())},
        }
    return out


def neural_probs(session, tokenizer, texts) -> np.ndarray:
    enc = tokenizer(texts, truncation=True, max_length=MAX_LENGTH,
                    padding="max_length", return_tensors="np")
    logits = session.run(None, {"input_ids": enc["input_ids"].astype(np.int64),
                                "attention_mask": enc["attention_mask"].astype(np.int64)})[0]
    return 1.0 / (1.0 + np.exp(-logits))


def gold_matrix(rows) -> np.ndarray:
    return np.array([[r["labels"][l] for l in LABELS] for r in rows], dtype=np.int64)


def heuristic_matrix(scores_for_split) -> np.ndarray:
    return np.array([[row[l] for l in LABELS] for row in scores_for_split], dtype=np.float64)


# --------------------------------------------------------------------------- #
# Ensemble rules. Each takes (neural, lexical) probability matrices -> fused.
# --------------------------------------------------------------------------- #
def rule_max(n, h):
    return np.maximum(n, h)


def rule_noisy_or(n, h):
    return 1 - (1 - n) * (1 - h)


def make_rule_weighted(w: float):
    def rule(n, h):
        return w * n + (1 - w) * h
    rule.__name__ = f"weighted_{w:.1f}"
    return rule


def rule_lexicon_confirms(n, h):
    """Neural score, lifted where the high-precision lexicon agrees.

    The measured profile is complementary: the lexicon is precise but narrow
    (micro P 0.94 / R 0.39 on authored text), the model is broader but looser.
    So take the model's coverage and let a lexicon hit act as corroboration
    rather than as an independent vote.
    """
    return np.clip(n + 0.35 * h * (1 - n), 0, 1)


RULES = [rule_max, rule_noisy_or, rule_lexicon_confirms,
         make_rule_weighted(0.7), make_rule_weighted(0.5), make_rule_weighted(0.3)]


def calibrate(probs, gold, lo=0.20, hi=0.80, precision_floor=0.70) -> np.ndarray:
    """Same bounded, precision-floored calibration used in training."""
    grid = np.arange(lo, hi + 1e-9, 0.01)
    out = np.full(len(LABELS), 0.5)
    for i in range(len(LABELS)):
        g = gold[:, i].astype(bool)
        scored = [(t, *prf(probs[:, i] >= t, g)) for t in grid]
        eligible = [x for x in scored if x[1] >= precision_floor]
        pool = eligible if eligible else scored
        out[i] = float(max(pool, key=lambda x: (round(x[3], 6), x[0]))[0])
    return out


def print_table(title: str, results: dict[str, dict]) -> None:
    print(f"\n{'=' * 88}\n{title}\n{'=' * 88}")
    print(f"{'system':<28} {'macroF1':>8} {'microP':>8} {'microR':>8} {'microF1':>8} {'exact':>8}")
    print("-" * 88)
    for name, m in results.items():
        print(f"{name:<28} {m['macro_f1']:8.3f} {m['micro_precision']:8.3f} "
              f"{m['micro_recall']:8.3f} {m['micro_f1']:8.3f} {m['exact_match'] * 100:7.1f}%")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("ml/models/ruko-manip-v1"))
    ap.add_argument("--data", type=Path, default=Path("ml/data/processed"))
    ap.add_argument("--holdout", type=Path,
                    default=Path("ml/datasets/holdout/test_holdout.jsonl"))
    ap.add_argument("--heuristic-scores", type=Path,
                    default=Path("ml/data/derived/heuristic_scores.json"))
    args = ap.parse_args()

    if not args.heuristic_scores.exists():
        print("run `node ml/evaluation/export_heuristic_scores.ts` first", file=sys.stderr)
        return 1

    ckpt = torch.load(args.model_dir / "pytorch_model.pt", map_location="cpu", weights_only=False)
    trained_thresholds = np.array(ckpt["thresholds"])
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir / "tokenizer")
    lex_scores = json.loads(args.heuristic_scores.read_text())

    torch_model = RukoManipulationClassifier(ckpt["base_model"])
    torch_model.load_state_dict(ckpt["state_dict"])
    torch_model.eval()

    onnx_dir = args.model_dir / "onnx"
    sess_fp32 = ort.InferenceSession(str(onnx_dir / "model_fp32.onnx"),
                                     providers=["CPUExecutionProvider"])
    sess_int8 = ort.InferenceSession(str(onnx_dir / "model_int8.onnx"),
                                     providers=["CPUExecutionProvider"])

    splits = {
        "val": load_jsonl(args.data / "val.jsonl"),
        "test": load_jsonl(args.data / "test.jsonl"),
        "holdout": load_jsonl(args.holdout),
    }

    cache: dict[str, dict[str, np.ndarray]] = {}
    for name, rows in splits.items():
        texts = [r["text"] for r in rows]
        enc = tokenizer(texts, truncation=True, max_length=MAX_LENGTH,
                        padding="max_length", return_tensors="pt")
        with torch.no_grad():
            pt = torch.sigmoid(torch_model(enc["input_ids"], enc["attention_mask"])).numpy()
        cache[name] = {
            "gold": gold_matrix(rows),
            "pytorch": pt,
            "onnx_fp32": neural_probs(sess_fp32, tokenizer, texts),
            "onnx_int8": neural_probs(sess_int8, tokenizer, texts),
            "lexicon": heuristic_matrix(lex_scores[name]),
        }
        print(f"scored {name}: {len(rows)} rows")

    # --- pick the ensemble rule on VALIDATION only --------------------- #
    print(f"\n{'=' * 88}\nENSEMBLE RULE SELECTION (validation split only)\n{'=' * 88}")
    val = cache["val"]
    best_rule, best_score, rule_table = None, -1.0, {}
    for rule in RULES:
        fused = rule(val["pytorch"], val["lexicon"])
        th = calibrate(fused, val["gold"])
        m = summarise(fused, val["gold"], th)
        rule_table[rule.__name__] = {"macro_f1": m["macro_f1"],
                                     "micro_precision": m["micro_precision"],
                                     "micro_recall": m["micro_recall"]}
        print(f"  {rule.__name__:<24} macro F1 {m['macro_f1']:.4f}  "
              f"P {m['micro_precision']:.3f}  R {m['micro_recall']:.3f}")
        if m["macro_f1"] > best_score:
            best_rule, best_score = rule, m["macro_f1"]
    print(f"\nselected: {best_rule.__name__} (validation macro F1 {best_score:.4f})")

    ensemble_thresholds = calibrate(best_rule(val["pytorch"], val["lexicon"]), val["gold"])
    lexicon_thresholds = calibrate(val["lexicon"], val["gold"])
    print(f"ensemble thresholds: "
          f"{ {l: round(float(t), 2) for l, t in zip(LABELS, ensemble_thresholds)} }")

    # --- report on test and holdout, choices already fixed ------------- #
    report: dict = {"ensemble_rule": best_rule.__name__,
                    "rule_selection_on_validation": rule_table,
                    "thresholds": {
                        "neural": {l: round(float(t), 3) for l, t in zip(LABELS, trained_thresholds)},
                        "ensemble": {l: round(float(t), 3) for l, t in zip(LABELS, ensemble_thresholds)},
                        "lexicon": {l: round(float(t), 3) for l, t in zip(LABELS, lexicon_thresholds)},
                    },
                    "splits": {}}

    for split_name, title in [
        ("test", "GENERATED TEST SPLIT — family-disjoint, but shares style with training"),
        ("holdout", "HAND-AUTHORED HOLDOUT — no template overlap — THE HONEST NUMBER"),
    ]:
        c = cache[split_name]
        # The lexicon is reported at BOTH operating points. Its weights were
        # hand-designed for a 0.5 cut; recalibrating them on the validation
        # families transfers badly to authored text, and reporting only the
        # recalibrated number would understate the baseline we must beat.
        systems = {
            "lexicon @0.5 (as designed)": summarise(c["lexicon"], c["gold"], np.full(len(LABELS), 0.5)),
            "lexicon (val-calibrated)": summarise(c["lexicon"], c["gold"], lexicon_thresholds),
            "neural pytorch fp32": summarise(c["pytorch"], c["gold"], trained_thresholds),
            "neural onnx fp32": summarise(c["onnx_fp32"], c["gold"], trained_thresholds),
            "neural onnx int8": summarise(c["onnx_int8"], c["gold"], trained_thresholds),
            f"ensemble ({best_rule.__name__})":
                summarise(best_rule(c["pytorch"], c["lexicon"]), c["gold"], ensemble_thresholds),
            f"ensemble int8 ({best_rule.__name__})":
                summarise(best_rule(c["onnx_int8"], c["lexicon"]), c["gold"], ensemble_thresholds),
        }
        print_table(f"{title}  ({len(splits[split_name])} rows)", systems)
        report["splits"][split_name] = {
            "rows": len(splits[split_name]),
            "systems": systems,
            "confusion_matrices_ensemble_int8": confusion_matrices(
                best_rule(c["onnx_int8"], c["lexicon"]), c["gold"], ensemble_thresholds),
        }

    hold = report["splits"]["holdout"]["systems"]
    lex = max(hold["lexicon @0.5 (as designed)"]["macro_f1"],
              hold["lexicon (val-calibrated)"]["macro_f1"])
    neural = hold["neural onnx int8"]["macro_f1"]
    ens = hold[f"ensemble int8 ({best_rule.__name__})"]["macro_f1"]
    report["verdict"] = {
        "lexicon_macro_f1": lex,
        "neural_int8_macro_f1": neural,
        "ensemble_int8_macro_f1": ens,
        "neural_beats_lexicon": neural > lex,
        "ensemble_beats_both": ens > max(lex, neural),
        "recommended": ("ensemble" if ens > max(lex, neural)
                        else "neural" if neural > lex else "lexicon"),
    }

    out_path = args.model_dir / "evaluation.json"
    report["evaluated_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out_path.write_text(json.dumps(report, indent=2) + "\n")

    print(f"\n{'=' * 88}\nVERDICT (authored holdout, macro F1)\n{'=' * 88}")
    print(f"  lexicon only        {lex:.3f}")
    print(f"  neural int8 only    {neural:.3f}")
    print(f"  ensemble int8       {ens:.3f}")
    print(f"  -> ship: {report['verdict']['recommended'].upper()}")
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
