# Integration notes — mobile

What has to happen when the other two workstreams merge into `main`, and the
two decisions we need to agree on. Written by Aishwarya; corrections welcome.

## 1. We have two ways of importing the contracts. Vedant's should win.

- **Mine (on `feature/aishwarya-ui`)**: `@contracts` is aliased to
  `docs/contracts/` in `tsconfig.json`, `babel.config.js` and
  `metro.config.js` (via `watchFolders`), plus a `docs/contracts/index.ts`
  barrel.
- **Vedant's (on `feature/vedant-ml`)**: `mobile/src/contracts/index.ts`, a
  generated bundle of all the schemas, produced by
  `mobile/src/contracts/sync_contracts.py`. No Metro configuration needed.

His avoids `watchFolders`, which is genuinely fragile on Metro, and it has a
`--check` mode that can run in CI. **Proposal: adopt his.** On merge:

1. Delete `docs/contracts/index.ts` (my barrel).
2. Point the `@contracts` alias at `src/contracts/index.ts` in all three config
   files and drop `watchFolders` from `metro.config.js`.
3. Run `python3 mobile/src/contracts/sync_contracts.py` so
   `providers.schema.ts` is included in the bundle.

Every `import ... from '@contracts'` in the mobile tree then keeps working
unchanged. This is one config change, not a refactor.

## 2. Swapping the stubs for the real implementations

All of it happens in `src/services/createServices.ts`. Nothing else changes.

| Stub | Replace with | Notes |
| --- | --- | --- |
| `stubRiskEngine` | `evaluateRisk` / `getRiskEngineConfig` from `src/risk` | Wrap in the `RiskEngine` shape: `{evaluate: evaluateRisk, getConfig: getRiskEngineConfig}` |
| `StubBehaviourStore` | `buildProfile` / `evaluateBehaviour` / `evaluatePayee` from `src/risk` | Keep the `BehaviourStore` interface so the demo seeding still works |
| `LexicalClassifier` | the ONNX classifier | Same `LocalRiskClassifier` interface; the engineering screen will start reporting a real backend and model hash on its own |
| `createStubAgent` | `src/agent` | Must keep emitting `TraceEntry` — the investigation screen reads nothing else |
| device providers | Puneesh's native bridge | Shapes are in `docs/contracts/providers.schema.ts` |
| `StubGuardianChannel` | the WebSocket channel | `sendAlert` **must** resolve to `null` on timeout or disconnect; the phone falls back to its own decision |

Delete `src/services/stubs/` when the last one goes. The scenarios in
`stubs/scenarios.ts` should survive the move — they are demo *input*, and Demo
Mode is supposed to run the real pipeline.

## 3. Two things I changed that are not mine

- `docs/contracts/guardian.schema.ts` imported `RiskScore` from
  `./risk.schema`, which does not re-export it — the contracts did not compile.
  Changed to import it from `./common.schema`. One line, no shape change.
- Added `docs/contracts/providers.schema.ts` (contracts-v1.1, additive): the
  device provider interfaces and the `RukoServices` container. It is a
  proposal from the UI side so the screens could be built against something.
  **Puneesh owns the Android provider shapes** — if `read()`/`subscribe()` is
  not what the native layer can give us, change it and I will adapt the
  adapters.

## 4. Where the native code lives

Puneesh's `android/ruko-core` is a pure-JVM Kotlin module at the repo root and
the React Native Android project is at `mobile/android/` — React Native
requires the latter to sit inside the JS project. These do not collide: the RN
app's Gradle build can depend on `ruko-core` as a module when the bridge lands.
