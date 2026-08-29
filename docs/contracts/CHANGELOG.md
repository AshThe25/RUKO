# Contract changelog

## contracts-v1 — 2026-08-29 — Vedant
Initial contracts: conversation, payment, risk, investigation, guardian.
No consumers existed yet, so this is not a breaking change for anyone.

## contracts-v1.1 — 2026-08-29 — Aishwarya
Additive only. No existing type changed, so nothing breaks.

- Added `providers.schema.ts`: `ContextProvider<T>` and the call / payment /
  notification / conversation provider shapes, `BehaviourStore`,
  `EngineDiagnostics` + `DiagnosticsProvider`, and `RukoServices` — the single
  container the mobile app injects.
  These are a **proposal** from the mobile side so the UI can be built against
  an interface instead of waiting. Puneesh owns the Android provider shapes and
  Vedant the classifier/agent ones — change them if reality disagrees, and note
  it here.
- Added `index.ts` so consumers can `import type {...} from '@contracts'`.
