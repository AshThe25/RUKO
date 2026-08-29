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

## contracts-v1.2 — 2026-08-29 — Puneesh (landed by Aishwarya during the rebase)
Additive only.

- Added `guardian-protocol.schema.ts`: the guardian **wire** protocol — REST
  payloads for device registration and pairing, the WebSocket envelope types,
  heartbeats and relay errors. Written by Puneesh on his branch as
  `guardian.schema.ts`; renamed on landing because it is complementary to the
  existing `guardian.schema.ts` (the phone-side `GuardianChannel` abstraction),
  not a replacement for it. Content is unchanged.
- Not re-exported from `index.ts`: it declares its own `InferenceBackend`,
  which collides with the one in `conversation.schema.ts`. Reconciling those is
  part of the open contract reconciliation.
