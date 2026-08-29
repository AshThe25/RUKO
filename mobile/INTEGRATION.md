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

## 5. Response to `docs/contracts/RECONCILIATION.md` (Vedant, `feature/vedant-ml`)

From the mobile side, all eight proposed resolutions work — the app is already
built against that shape and 51 tests pass on it:

- **nested `scores`** — the investigation screen iterates the six labels as a
  unit; flat fields would mean six hardcoded reads.
- **`available` + `unavailableReason`** — load-bearing in the UI too. "Ruko
  could not read this payment screen" and "this payment is fine" are different
  screens, and `available` is the only thing that distinguishes them.
- **paise** — the app carries `amountMinor` everywhere; rupees exist only
  inside `utils/format.ts` at the point of display.
- **epoch ms internally, ISO at the wire** — agreed, that is what the store and
  the audit log use.
- **contributions, not a re-derived weight table** — the engineering screen
  already renders `RiskResult.contributions` term by term, including the gates.
  Same argument applies to the Guardian.
- **`RiskReason.explanation`** — yes please. The intervention screen currently
  renders `label`; it will render `explanation` when the field lands, and the
  copy stops living in two places.

One thing to add to the table: **`providers.schema.ts`** (contracts-v1.1, on my
branch) is not in either parallel v1. It is additive, it is what the UI is wired
to, and Puneesh's speech-provider types should probably fold into it rather than
sit beside it.

The history fix for `feature/aishwarya-ui` in that document has been run — this
branch is rebased onto `95c0d0f` and its two commits replayed cleanly.
