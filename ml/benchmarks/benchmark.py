#!/usr/bin/env python3
"""Benchmark the exported models. Every number here is measured on this machine.

    ml/.venv/bin/python ml/benchmarks/benchmark.py

WHAT THIS IS NOT: a phone benchmark. These are host-CPU numbers. On-device
latency on the iQOO 15 is a different number and is measured by the app itself
at runtime, then shown on the engineering screen from real inferences. Nothing
in this repository claims a device latency that was not measured on a device.

Reported per configuration:
  cold start   time to construct the session (matters: it happens on launch)
  p50/p95/p99  single-window latency, which is what a user waits for
  throughput   batch-8, which is what matters for re-scoring a backlog
  memory       process RSS delta around session creation, where measurable
"""

from __future__ import annotations

import argparse
import gc
import json
import statistics
import time
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # ml/
from paths import resolve  # noqa: E402

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

MODEL_DIR = resolve("ml/models/ruko-manip-v1")

SAMPLES = [
    "hello sir i am calling from your bank your account will be frozen you must "
    "transfer 48000 immediately do not disconnect this call",
    "can you send me 500 for dinner last night",
    "main crime branch se bol raha hoon aapka account block ho jayega turant paisa bhej dijiye",
    "the traffic was terrible today it took me a full hour to reach office",
    "tell me the otp you have just received on your phone right now please",
]


def rss_mb() -> float | None:
    """Process resident set size, without adding a psutil dependency."""
    try:
        import resource
        import sys
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports kilobytes, macOS reports bytes.
        return peak / (1e6 if sys.platform == "darwin" else 1e3)
    except Exception:
        return None


def bench_session(path: Path, tokenizer, runs: int, warmup: int) -> dict:
    gc.collect()
    before = rss_mb()

    cold_start = time.perf_counter()
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    cold_ms = (time.perf_counter() - cold_start) * 1000

    after = rss_mb()

    encodings = [
        tokenizer(text, truncation=True, max_length=64, padding=False, return_tensors="np")
        for text in SAMPLES
    ]

    for i in range(warmup):
        e = encodings[i % len(encodings)]
        session.run(None, {"input_ids": e["input_ids"].astype(np.int64),
                           "attention_mask": e["attention_mask"].astype(np.int64)})

    single = []
    for i in range(runs):
        e = encodings[i % len(encodings)]
        feeds = {"input_ids": e["input_ids"].astype(np.int64),
                 "attention_mask": e["attention_mask"].astype(np.int64)}
        t0 = time.perf_counter()
        session.run(None, feeds)
        single.append((time.perf_counter() - t0) * 1000)
    single.sort()

    batch = tokenizer(SAMPLES + SAMPLES[:3], truncation=True, max_length=64,
                      padding="max_length", return_tensors="np")
    batch_feeds = {"input_ids": batch["input_ids"].astype(np.int64),
                   "attention_mask": batch["attention_mask"].astype(np.int64)}
    batch_times = []
    for _ in range(20):
        t0 = time.perf_counter()
        session.run(None, batch_feeds)
        batch_times.append((time.perf_counter() - t0) * 1000)

    n_batch = batch["input_ids"].shape[0]
    return {
        "file": path.name,
        "size_mb": round(path.stat().st_size / 1e6, 2),
        "cold_start_ms": round(cold_ms, 1),
        "single_window_ms": {
            "runs": runs,
            "p50": round(single[len(single) // 2], 3),
            "p95": round(single[int(len(single) * 0.95)], 3),
            "p99": round(single[int(len(single) * 0.99)], 3),
            "mean": round(statistics.fmean(single), 3),
            "stdev": round(statistics.stdev(single), 3) if len(single) > 1 else None,
            "min": round(single[0], 3),
            "max": round(single[-1], 3),
        },
        "batch": {
            "batch_size": int(n_batch),
            "p50_ms": round(sorted(batch_times)[len(batch_times) // 2], 3),
            "windows_per_second": round(
                n_batch / (statistics.fmean(batch_times) / 1000), 1),
        },
        "rss_mb_before": round(before, 1) if before else None,
        "rss_mb_after": round(after, 1) if after else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=20)
    ap.add_argument("--out", type=Path, default=MODEL_DIR / "benchmarks.json")
    args = ap.parse_args()

    import platform
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR / "tokenizer")

    results = []
    for name in ("model_fp32.onnx", "model_int8.onnx"):
        path = MODEL_DIR / "onnx" / name
        if not path.exists():
            print(f"skipping {name}: not exported")
            continue
        print(f"benchmarking {name} ...")
        results.append(bench_session(path, tokenizer, args.runs, args.warmup))

    report = {
        "host": {
            "platform": platform.platform(),
            "processor": platform.processor() or platform.machine(),
            "python": platform.python_version(),
            "onnxruntime": ort.__version__,
            "providers": ort.get_available_providers(),
        },
        "disclaimer": "Host CPU only. NOT an iQOO 15 measurement. On-device "
                      "latency is measured by the app at runtime and shown on "
                      "the engineering screen.",
        "results": results,
        "measured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    args.out.write_text(json.dumps(report, indent=2) + "\n")

    print(f"\n{'=' * 76}")
    print(f"host: {report['host']['platform']}  ort {ort.__version__}")
    print("=" * 76)
    print(f"{'model':<18} {'size':>8} {'cold':>9} {'p50':>8} {'p95':>8} {'p99':>8} {'win/s':>8}")
    print("-" * 76)
    for r in results:
        s = r["single_window_ms"]
        print(f"{r['file']:<18} {r['size_mb']:7.1f}M {r['cold_start_ms']:8.0f}ms "
              f"{s['p50']:7.2f}ms {s['p95']:7.2f}ms {s['p99']:7.2f}ms "
              f"{r['batch']['windows_per_second']:8.1f}")
    print("=" * 76)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
