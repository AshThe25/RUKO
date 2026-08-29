# Ruko — ML, on-device inference and risk engine

Owner: Vedant. Scope: `ml/`, `mobile/src/{risk,agent,tools}`.

Everything described here runs **on the phone, with the network off**. The
backend is not in the decision path and there is no cloud LLM anywhere in it.

---

## The one-paragraph version

A compact classifier reads a window of on-device speech and reports six
*manipulation tactics* — not "is this a scam". A deterministic engine fuses
those with local payment context (is this recipient new, is this amount unusual
for you, are you on a call) and produces a 0–100 score with every term it used
attached. The model gathers evidence; a testable pure function decides. That
separation is what lets a false positive be survivable and every intervention be
explained.

## Results

Two numbers are reported everywhere, always:

| System | Generated test | **Authored holdout** |
|---|---|---|
| Lexicon only (`ruko-heuristic-v1`) | 0.728 | **0.508** |
| Neural int8 (`ruko-manip-v1`) | 0.633 | **0.621** |
| **Ensemble int8 (ships)** | **0.837** | **0.631** |

Macro F1. The generated test split is family-disjoint from training but shares a
*style* with it, so it is optimistic. The authored holdout was hand-written,
shares no templates with the generator, and is the honest number. **The gap
between the two columns is the measured cost of training on synthetic data**, and
it is reported rather than buried.

Ensemble micro precision on authored text is 0.692 at recall 0.597. Full
per-label tables, thresholds and confusion matrices:
`ml/models/ruko-manip-v1/evaluation.json`.

### Why an ensemble

The two systems fail differently, which is the whole reason to keep both:

- **Lexicon**: precision 0.941, recall 0.387. Almost never wrong, but only
  catches phrasings somebody anticipated.
- **Neural**: precision 0.638, recall 0.597. Generalises to unseen phrasing,
  looser about it.

Fused 50/50 on raw probabilities, precision recovers to 0.692 without losing the
model's coverage. The fusion rule was chosen on the **validation** split from six
candidates; the holdout was scored once afterwards with that choice fixed.

### What the model is

MiniLM-L6 (6 layers, 384 hidden, 22.7 M parameters), a 6-way multi-label head,
sigmoid per label. Only 3.7 M parameters are trainable — the embeddings and the
bottom four encoder blocks are frozen.

That freezing was not a default, it was a fix. The first run memorised the
templates instead of learning the tactics: training loss fell 0.44 → 0.018
between epochs 1 and 2 while validation F1 *dropped*, and unconstrained
threshold calibration then picked 0.05 for urgency and 0.95 for coercion, which
transferred terribly to authored text. Freezing the lower layers, softening
`pos_weight` to `sqrt(neg/pos)`, and bounding calibration to [0.20, 0.80] with a
0.70 precision floor moved the authored holdout from 0.574 → 0.627 macro F1 and
closed the generalisation gap from −0.083 to −0.012.

## Honesty rules this pipeline enforces

1. **The test split is loaded once, at the end.** It never selects an epoch, a
   threshold or a fusion rule.
2. **Splits are disjoint by template family**, not by row. Splitting rows
   randomly would put paraphrases of training rows into the test set.
3. **A hand-authored holdout exists** precisely because the generated test split
   flatters us, and both are always reported together.
4. **`authority` means an authority *claim*, not impersonation.** Speech cannot
   verify identity, so genuine bank calls carry the same label. It becomes risk
   only when the risk engine fuses it with payment context. Labelling it
   "impersonation" would have taught the model to flag every real
   customer-service call.
5. **No metric in this repo was written by hand.** Every number in this file
   comes from a JSON artefact produced by a script you can re-run.

## The risk engine

`points = signal × weight × gate`, summed and clamped to 100. Weights and
thresholds: `mobile/src/risk/weights.ts`.

The gates are where the product thesis lives:

- Conversation points scale by classifier reliability, and are **discarded
  entirely** below 0.35 — a four-word fragment contributes nothing, not a little.
- Amount anomaly is **withheld completely** until the behaviour profile has 8+
  transactions, and damped to 0.4× for a payee paid 3+ times before.
- Missing evidence never becomes a zero. An unreadable payee is not a "new
  payee"; `callerKnown === null` is not an "unknown caller".

**CRITICAL** — the only level that shows *DON'T PAY* — additionally requires two
independent evidence families, each above 35% of its own maximum. A maximal
conversation with nothing corroborating it is held at HIGH. This is the main
defence against a model false positive costing someone a real rent transfer, and
it is tested.

Two documented deviations from the master spec's weight table: it sums to 117
and clamps rather than partitioning 100 (partitioning makes every individual
signal too weak to matter), and `credentialRequest` is added at weight 14
(omitting it would make Ruko blind to the most common attack in Indian payment
fraud). Both are argued in `weights.ts`.

## Reproducing everything

```bash
python3 -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt

python3 ml/datasets/holdout/author_holdout.py       # authored holdout
python3 ml/datasets/generate.py --out ml/data       # 8,400 rows, seeded
ml/.venv/bin/python ml/training/train.py            # ~70 s on an M-series GPU
node ml/evaluation/export_heuristic_scores.ts
ml/.venv/bin/python ml/export/export_onnx.py        # ONNX + int8 + parity
ml/.venv/bin/python ml/evaluation/evaluate.py       # the comparison table
ml/.venv/bin/python ml/export/emit_parity_fixture.py
ml/.venv/bin/python ml/benchmarks/benchmark.py

./scripts/test-risk.sh                              # 159 tests
node scripts/demo-scenarios.ts                      # the demo, end to end
```

The generator is fully seeded: the same seed produces byte-identical files.

## Measured performance (host CPU, not a phone)

macOS arm64, onnxruntime 1.29.0, 200 runs, single 64-token window:

| | size | cold start | p50 | p95 |
|---|---|---|---|---|
| fp32 | 90.4 MB | 53 ms | 1.44 ms | 1.89 ms |
| int8 | 22.9 MB | 40 ms | 1.12 ms | 1.64 ms |

int8 costs **0.006 macro F1** on authored text for a 4× size reduction. Its
acceptance is judged on decision flips (1.87% of label decisions), not raw
probability drift — a probability moving 0.91 → 0.37 only matters if it crosses
a threshold.

**These are host numbers.** On-device latency on the iQOO 15 is measured by the
app at runtime and shown on the engineering screen. No device number is claimed
anywhere until it has been taken on the device.

## Known limitations

1. **Synthetic training data has a ceiling.** Real scam calls are longer and
   more improvisational than templates. The authored holdout probes this; it
   does not remove it. Authored macro F1 of 0.631 is a usable signal for a
   fusion engine, not a solved problem.
2. **Roman script only.** English and romanised Hinglish. Devanagari needs a
   multilingual tokenizer roughly 5× larger, which conflicts with the on-device
   size budget — deferred to a Sarvam-backed path.
3. **Windows, not dialogue.** No speaker diarisation, so the classifier cannot
   tell who said what.
4. **The RN ONNX adapter has not run on a device yet.** See
   `docs/ml/ANDROID_HANDOFF.md`. Until it has, no NNAPI claim should be made.
5. **The behaviour profile needs 8+ transactions.** A brand-new install is
   deliberately conservative and says so in the UI rather than guessing.
