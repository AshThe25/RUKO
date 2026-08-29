# On-device classifier — integration guide

**For: Puneesh (native / RN bridge) and Aishwarya (UI).**
Owner of everything described here: Vedant. If something in this document is
wrong or awkward to integrate, tell me and I will change my side — please do not
work around it in `android/`.

## What you get

```ts
import { createClassifier } from 'mobile/src/risk/classifier';
import { createReactNativeAdapter } from 'mobile/src/risk/classifier/reactNativeRuntime';
import { RukoAgent } from 'mobile/src/agent';
import { buildDiagnostics, diagnosticsLines } from 'mobile/src/risk/diagnostics';
```

Three calls, matching the interface agreed in my brief:

| Call | Returns |
|---|---|
| `loadModel()` | `ModelInfo` — version, real hash, **actual** backend, size |
| `classify(text)` | `ConversationEvidence` — six calibrated scores + reliability |
| `getModelInfo()` | `ModelInfo`, including measured p50/p95 latency once it has run |

## Wiring it up

```ts
const adapter = createReactNativeAdapter({ ort, fs });   // onnxruntime-react-native, react-native-fs

const { classifier, neural, fallbackReason } = await createClassifier({
  adapter,
  modelPath: `${RNFS.DocumentDirectoryPath}/ruko/model_int8.onnx`,
  vocabPath: `${RNFS.DocumentDirectoryPath}/ruko/vocab.txt`,
  backendPreference: ['NNAPI', 'XNNPACK', 'CPU'],
});
```

`createClassifier` **never throws**. If the model cannot load you get the
lexical classifier and a `fallbackReason`. Show the reason on the engineering
screen; do not hide it.

## Assets you need to bundle

From `ml/models/ruko-manip-v1/onnx/` — both are gitignored, so ask me for them
or run `ml/.venv/bin/python ml/export/export_onnx.py`:

| File | Size | Notes |
|---|---|---|
| `model_int8.onnx` | 22.9 MB | the one to ship |
| `vocab.txt` | 232 KB | must match the model; the loader checks |
| `model_fp32.onnx` | 90.4 MB | do **not** ship; for evaluation only |

ONNX Runtime needs a real filesystem path, not an `asset://` URI, so copy both
out of assets on first launch. `model_int8.onnx` sha256 is pinned in
`mobile/src/risk/classifier/modelConfig.generated.ts` and **the loader refuses a
mismatch** — the shipped thresholds were calibrated against that exact file.

## Two things I need from your side

**1. Report the execution provider truthfully.** The adapter requests one
provider at a time and reports which one initialised, because ONNX Runtime will
create an NNAPI session on a device whose driver then silently falls back to CPU
per-operator. Please do not "simplify" this into requesting `['nnapi','cpu']`
together — we would lose the ability to say what really ran, and the engineering
screen would start lying.

**2. A `sha256File` implementation, if it is cheap.** Optional. Returning `null`
is fine and honest: the classifier then reports `unverified:<expected>` rather
than pretending it checked.

## Providers I need from Android

Implement these (in `mobile/src/tools/providers.ts`) and the agent works
unchanged:

```ts
ConversationProvider  getRecentTranscript() -> { text, windowMs, asrConfidence } | null
PaymentProvider       getPaymentContext()   -> PaymentEvidence
CallProvider          getCallContext()      -> CallEvidence
NotificationProvider  getNotificationContext() -> NotificationEvidence
HistoryStore          getTransactions(), getTrustedPayees()
```

Two requests:

- **Set `source` honestly.** `'ACCESSIBILITY'` only when it really came from a
  node tree; `'DEMO'` for RukoPayDemo. It is displayed and audited.
- **Use `available: false` rather than a zero.** "I could not read the payee"
  and "this is a new payee" are different facts, and the risk engine treats them
  completely differently. Every evidence type has `available` and
  `unavailableReason` for this.

Working reference implementations of all five are in
`mobile/src/tools/demoProviders.ts`, and they are what the tests run against.

## Money is in paise

`amountMinor` is an integer number of **paise**. ₹48,000 is `4_800_000`. Rupee
floats truncate silently and the bug only shows up in a demo.

## Engineering screen

```ts
const d = buildDiagnostics({
  modelInfo: classifier.getModelInfo(),
  isFallback: !neural,
  fallbackReason,
  networkReachable: await isNetworkReachable(),   // optional, may be null
});
for (const [label, value] of diagnosticsLines(d)) { /* render */ }
```

Latency is `null` until real inferences have run — please render that as "not
yet measured" rather than as `0 ms`.

## Note for Aishwarya

`mobile/src/services/stubs/lexicalClassifier.ts` on your branch is superseded by
`mobile/src/risk/classifier/` once we merge. Mine implements the same
`LocalRiskClassifier` contract, is evaluated (macro F1 0.508 standalone, 0.631
fused with the neural model on authored text), and handles benign-context cases
such as "never share your OTP with anyone". Swap the import and delete the stub
whenever it suits you — no rush, and nothing else needs to change.

## Status: what has and has not been run

| Component | Verified how |
|---|---|
| Risk engine, behaviour, payee, policy | 159 passing unit tests |
| Agent + tools + full demo scenarios | end-to-end tests, real pipeline |
| Lexical classifier | evaluated on 1,200 generated + 107 authored rows |
| Tokenizer | exact token-id match with HuggingFace, 14 cases |
| ONNX export and int8 quantisation | parity + benchmarks measured on host CPU |
| **`reactNativeRuntime.ts`** | **NOT RUN ON A DEVICE YET** |

That last row is the one piece I cannot test from here. It is deliberately thin
for that reason. Until it runs on the iQOO 15, **nobody should claim NNAPI
acceleration in the pitch** — once it does, the engineering screen will report
the truth on its own, whatever that turns out to be.
