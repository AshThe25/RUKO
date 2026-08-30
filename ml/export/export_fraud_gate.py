#!/usr/bin/env python3
"""Export the binary fraud gate to int8 ONNX.

    python3 ml/export/export_fraud_gate.py

WHY A SEPARATE SCRIPT: export_onnx.py is written for ruko-manip-v1, which has
six outputs behind a plain Linear head. The gate (RealFraudGate) has ONE output
behind a Sequential, so loading its state_dict into the six-tactic class fails
on `head.weight` vs `head.1.weight`. Two architectures, two exporters.

WHAT THE OUTPUT MEANS: a single logit -> sigmoid -> P(fraud). It is NOT a
seventh tactic and must not be fed to the risk engine as one. The engine scores
six tactics and requires two independent evidence families; one binary score
satisfies neither. Wire it as a bounded corroborating source, the same shape as
notificationSuspicion, which can never reach CRITICAL alone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import resolve  # noqa: E402
from train_real_binary import RealFraudGate  # noqa: E402

PROBE = [
    "your account will be blocked complete kyc immediately",
    "hi are we still on for lunch tomorrow at one",
    "congratulations you have won click here to claim your prize now",
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("ml/models/ruko-real-multisource-v1"))
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    args.model_dir = resolve(args.model_dir)

    ckpt_path = args.model_dir / "pytorch_model.pt"
    if not ckpt_path.is_file():
        print(f"missing {ckpt_path} — retrain with train_real_binary.py", file=sys.stderr)
        return 1

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    base = ckpt.get("base_model", "sentence-transformers/all-MiniLM-L6-v2")
    model = RealFraudGate(base, ckpt.get("dropout", 0.2))
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    # RealFraudGate.forward squeezes to a scalar per row, which makes ONNX
    # shape inference disagree with itself during quantisation (384 vs 1).
    # Keep the export at [batch, 1]; the app squeezes on its own side.
    class _Exportable(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, input_ids, attention_mask):
            return self.inner(input_ids, attention_mask).reshape(-1, 1)

    exportable = _Exportable(model).eval()

    tok_dir = args.model_dir / "tokenizer"
    tokenizer = AutoTokenizer.from_pretrained(tok_dir if tok_dir.is_dir() else base)

    out_dir = args.model_dir / "onnx"
    out_dir.mkdir(parents=True, exist_ok=True)
    fp32 = out_dir / "model_fp32.onnx"
    int8 = out_dir / "model_int8.onnx"

    enc = tokenizer(PROBE[0], return_tensors="pt", truncation=True, max_length=64,
                    padding="max_length")
    torch.onnx.export(
        exportable,
        (enc["input_ids"], enc["attention_mask"]),
        str(fp32),
        input_names=["input_ids", "attention_mask"],
        output_names=["logit"],
        dynamic_axes={"input_ids": {0: "batch"}, "attention_mask": {0: "batch"},
                      "logit": {0: "batch"}},
        opset_version=args.opset,
        # Legacy tracer. The dynamo exporter emits a graph whose shape
        # inference disagrees with itself during quantisation (384 vs 1),
        # and manip-v1 already exports cleanly on this path.
        dynamo=False,
    )
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QUInt8)

    # Parity: quantisation must not move a decision across the threshold on
    # obvious cases. A silent int8 regression here would be invisible in the app.
    import onnxruntime as ort
    sess = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    threshold = float(ckpt.get("threshold", 0.5))
    print(f"\nthreshold {threshold}")
    worst = 0.0
    for text in PROBE:
        e = tokenizer(text, return_tensors="pt", truncation=True, max_length=64,
                      padding="max_length")
        with torch.no_grad():
            ref = torch.sigmoid(model(e["input_ids"], e["attention_mask"])).item()
        got = sess.run(None, {"input_ids": e["input_ids"].numpy(),
                              "attention_mask": e["attention_mask"].numpy()})[0]
        q = 1 / (1 + pow(2.718281828, -float(got.reshape(-1)[0])))
        worst = max(worst, abs(ref - q))
        flip = "" if (ref >= threshold) == (q >= threshold) else "  <-- DECISION FLIP"
        print(f"  fp32 {ref:.4f}  int8 {q:.4f}  {text[:44]!r}{flip}")

    card = {
        "model_version": ckpt.get("model_version", "ruko-real-multisource-v1"),
        "task": "binary suspected-fraud/manipulation text versus legitimate communication",
        "output": "single logit; sigmoid -> P(fraud). NOT a seventh tactic.",
        "base_model": base,
        "max_length": 64,
        "threshold_from_validation_only": threshold,
        "max_abs_prob_diff_fp32_vs_int8": round(worst, 4),
        "integration_note": (
            "Bounded corroborating evidence only, in the shape of notificationSuspicion. "
            "Must never reach CRITICAL alone; the six-tactic engine wins on disagreement."
        ),
        "artifacts": {
            p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in (fp32, int8)
        },
    }
    (out_dir / "onnx_card.json").write_text(json.dumps(card, indent=2) + "\n")

    print(f"\nfp32 {fp32.stat().st_size/1e6:.1f} MB -> int8 {int8.stat().st_size/1e6:.1f} MB")
    print(f"max prob drift {worst:.4f}")
    print(f"wrote {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
