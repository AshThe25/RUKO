# Contract changelog

## contracts-v1.3 — 2026-08-30 — Puneesh

One additive field, which is always safe.

- **Added** optional `textSource?: 'SPEECH' | 'MESSAGES'` to `ConversationEvidence`
  (`conversation.schema.ts`). Absent means `SPEECH`, which is what every
  existing producer emits, so nothing needs to change.

  WHY. The manipulation model was only ever fed ASR output. With no call in
  progress it never ran at all, so a scam conducted entirely over messages --
  which is most of them -- reached the risk engine as *no conversation evidence*
  and the notification family's 3-point ceiling was the only trace it left. On
  the device a textbook KYC scam, mid-payment, scored **10/100 SAFE**.

  The model reads language, and the tactics in a chat bubble are the same ones
  it was trained on. So when nothing was heard, the same classifier now reads
  the redacted notification excerpts instead. Same model, same engine, real
  text -- the evidence is measured, not manufactured. The same scam now scores
  66 and raises the intervention.

  `textSource` exists because "Ruko heard this" and "Ruko read this in your
  messages" are different claims and must never be shown as the same one.
  `riskEngine.reasonLabel()` picks the wording to match, so a warning no longer
  says "the caller is threatening you" when there was no call.

  Consumers that ignore the field keep their current behaviour exactly.

## contracts-v1.2 — 2026-08-30 — Puneesh

One rename, to fix a name collision that made the barrel unusable for the type
involved.

- **Renamed** `InferenceBackend` in `guardian.schema.ts` to
  `NativeInferenceBackend`. Unchanged members: `CPU | NNAPI | QUALCOMM | RULES
  | UNKNOWN`.

  `conversation.schema.ts` already exported a different `InferenceBackend`
  (`CPU | NNAPI | QNN | XNNPACK | HEURISTIC | UNAVAILABLE`). `index.ts`
  re-exports both, so `export *` collided and TypeScript raised TS2308 —
  the only production typecheck error in the mobile app. Neither name was
  importable from `@contracts`.

  This is a **rename, not an addition**, so by the rule in CLAUDE.md it is not
  automatically safe. It is safe here in fact: `NativeInferenceBackend` and the
  `RuntimeInfo` that holds it have no consumer anywhere in the repo outside
  `guardian.schema.ts` itself. Nothing to migrate — but shout if you were about
  to use it.

  The two types are kept separate rather than merged because they describe
  different layers and genuinely disagree: `ruko-core`'s Kotlin enum says
  `QUALCOMM`/`RULES`, and the app-facing contract says `QNN`/`HEURISTIC`.
  Collapsing them would have forced one layer to lie about what it reports.

  Related bug this exposed, fixed in `mobile/src/services/native/
  nativeProviders.ts`: `toInferenceBackend` only accepted the contract's
  spellings, so the `QUALCOMM` and `RULES` the bridge actually sends both fell
  through to `UNAVAILABLE`. A device running on the Qualcomm NPU reported no
  runtime at all on the Engineering screen. Now translated explicitly and
  covered by tests against the names native really emits.

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

## contracts-v1 — 2026-08-29 — Puneesh (reconciliation)

Two `docs/contracts/` were written in parallel before either of us saw the
other's. Vedant's landed on `main` and is consumed by the risk engine; mine sat
on a disjoint root commit and was consumed by the relay and Android layer.

**His win on everything shared.** They are already backed by a working engine
and 60 tests, and on each disputed point his reasoning was better:

- **Nested conversation scores** — the engine iterates them as a unit.
- **`EvidenceBase.available`** — load-bearing. Without it an unreadable payment
  screen reads as a safe payment, which is exactly the failure Ruko exists to
  prevent. Adopted in the Kotlin mirror.
- **Money in integer paise (`amountMinor`)** — rupee-only truncates silently.
  Converted the relay, the Office Kit, the Android providers and the screen
  parser. The parser now splits on the decimal point rather than going via a
  `Double`, because binary floating point cannot represent 0.10 exactly.
- **`UPPER_SNAKE` enums**, and his `RiskResult` adopted verbatim as the
  transport payload rather than my flatter `RiskAssessment`.

**What survived from mine**, per his own table: the wire protocol itself
(envelope, REST pairing, `ORIGINATOR` role enforcement), the speech-provider
types, and `RiskReason.label` as a plain-language explanation string.

### Three decisions that differ from the reconciliation proposal

1. **Timestamps on the wire are epoch ms, not ISO strings.** The alert embeds
   `RiskResult` verbatim and `RiskResult.timestamp` is epoch ms. Putting ISO on
   the envelope would mean the phone or relay *reshaping* the engine's own
   output at the boundary — extra drift surface, and a violation of "the relay
   never rewrites a payload". One convention end to end beat two with a
   converter between them. Vedant: one-line change on my side if you disagree.

2. **No separate `topReasons`.** `RiskResult.reasons` is already ordered by
   points descending, so the console renders the first three. A second list is
   a second place for the "why" to disagree with the score.

3. **`RISK_ALERT` / `GUARDIAN_ACTION` renamed to `GUARDIAN_ALERT` /
   `GUARDIAN_DECISION`**, matching the names in his guardian stub.

`guardian.schema.ts` is now the full transport contract, replacing the stub he
wrote so the risk layer had something to compile against.

### Verified after reconciliation

- 59 Kotlin core tests
- 43 relay tests, including a parity test that parses the canonical TypeScript
  and fails the build if the Python mirror drifts
- 21 Office Kit tests
- 21 live end-to-end checks over real websockets

### History

`feature/puneesh-android-guardian` was rebased onto `main` with
`git rebase --onto origin/main --root`, so it now shares history and merges
cleanly. My duplicate copies of the shared schemas were dropped in favour of
Vedant's during that rebase.
