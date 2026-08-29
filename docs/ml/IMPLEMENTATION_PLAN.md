# Ruko — ML / Risk implementation plan (Vedant)

Scope: `ml/`, `mobile/src/risk/`, `mobile/src/agent/`, `mobile/src/tools/`.
Everything here must work **with the network switched off**.

## Design decisions (and why)

**1. The model reports manipulation tactics, not "scam or not".**
A binary scam classifier cannot distinguish "your account will be frozen, send
₹48,000" from "send ₹50,000 rent to the landlord" without payment context, and it
gives the user nothing to read on the warning screen. Six multi-label tactics
(authority, coercion, urgency, financialInstruction, secrecy, credentialRequest)
are what the "WHY?" screen is built from, and they are what fuse with payment
context in the risk engine.

**2. The classifier never decides. The risk engine does.**
Model → `ConversationEvidence` → risk engine → `RiskResult`. The engine is a pure
function with versioned weights and unit tests. This is the audit story and the
reason a false positive on the model is survivable.

**3. Two classifiers, one interface.**
- `HeuristicClassifier` — deterministic lexical + pattern matcher, pure
  TypeScript, ~0 ms, no model file, works on any device from day one.
- `OnnxClassifier` — MiniLM-L6 multi-label head, ONNX, int8, via
  `onnxruntime-react-native` with CPU and NNAPI execution providers.

Both satisfy `LocalRiskClassifier`. The heuristic is the honest fallback when the
model fails to load — it is reported as `backend: 'HEURISTIC'` in the UI and the
audit trail, never disguised as neural inference. This also means the vertical
slice is demoable before the model is trained, and the demo cannot hard-fail.

**4. Model choice: MiniLM-L6 (6 layers, 384 hidden, 22M params).**
Rationale: smallest transformer that still handles paraphrase and Hinglish
code-mixing; ~90 MB fp32 → ~23 MB int8; short inputs (one transcript window,
≤128 tokens). Candidates benchmarked against a TF-IDF + logistic-regression
baseline — if the baseline is within noise of the transformer on the honest test
set, the baseline ships, because it is 100× smaller and faster. **The benchmark
decides, not the pitch.**

**5. Honest data splits.**
Synthetic data generated from templates will produce fake-looking 0.99 F1 if you
split rows randomly, because the test set then contains paraphrases of training
rows. Splits are therefore **disjoint by template family**, and there is a
separate hand-written `test_holdout.jsonl` that shares no templates with the
generator at all. Both are reported. Expect the honest number to be materially
lower than the template-split number; that is the point.

## Phases

| # | Deliverable | Definition of done |
|---|---|---|
| V1 | `ml/datasets/` generator | Seeded, reproducible, template-disjoint splits, dataset card with hash |
| V2 | `mobile/src/risk/` behaviour + payee engines | Unit tested, cold-start safe |
| V3 | `mobile/src/risk/` deterministic risk engine | The 3 DoD scenarios pass as tests |
| V4 | `mobile/src/risk/classifier/` heuristic classifier | Implements `LocalRiskClassifier`, tested |
| V5 | `mobile/src/tools/` + `mobile/src/agent/` | One agent, six tools, live trace, degrades on tool failure |
| V6 | `ml/training/` + `ml/evaluation/` | Real trained model, real per-label P/R/F1 + confusion matrices |
| V7 | `ml/export/` ONNX + int8 | Model card with sha256, verified parity vs. PyTorch |
| V8 | `mobile/src/risk/classifier/onnx` + TS tokenizer | Runs the exported model, same interface |
| V9 | `ml/benchmarks/` | Measured latency/size on CPU; on-device numbers when the iQOO 15 is available |
| V10 | Offline test + Android handoff doc for Puneesh | Network-disabled test passes; `loadModel/infer/getModelInfo` documented |

## Definition of done (from the master prompt, as executable tests)

1. `"Can you send me ₹500 for dinner?"` + known recipient → **LOW**
2. `"Your bank account will be frozen. Transfer ₹48,000 immediately."` +
   unknown caller + new recipient → **CRITICAL**
3. ₹50,000 rent, known landlord, regular date, no suspicious conversation →
   **not CRITICAL**

These live in `mobile/src/risk/__tests__/scenarios.test.ts` and must stay green.

## What I will not do

Train a large model, use a cloud LLM in the decision path, put inference in the
backend, claim NPU acceleration without measuring it, or write a metric I did not
compute.
