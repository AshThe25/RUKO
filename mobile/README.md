# mobile/ — the Ruko app

React Native + TypeScript. Owned by Aishwarya.

```bash
npm install
npm start          # metro
npm run android    # build + install on the connected iQOO 15
npm test           # 51 tests
npx tsc --noEmit
npm run lint
```

## Layout

```
src/
  theme/         design tokens — colours, spacing, type, motion
  components/    primitives: Txt, Screen, Card, Button, Pill, Row,
                 RiskScore, SignalBar, InvestigationStep, state views
  screens/       onboarding, permissions, home, investigation,
                 intervention, guardian, history, engineering, RukoPayDemo
  navigation/    state-driven router
  store/         protection state machine + orchestration controller
  services/      the service container and, for now, the stubs
  utils/         formatting (money is paise everywhere), ids
android/         native project — Puneesh's lane
```

React Native keeps `android/` inside the JS project, so native services live at
`mobile/android/app/src/main/java/com/ruko/` rather than at the repo root.

## How it is wired

Every screen reads services from React context. The container is built once in
[`src/services/createServices.ts`](src/services/createServices.ts) — that is the
only file that knows whether it is talking to a stub or the real thing, and the
only file that changes when the ML and Android layers land.

```
providers  →  investigation agent  →  risk engine  →  policy  →  screen
(stubbed)     (stubbed)               (stubbed)        real       real
```

The stubs are documented in
[`src/services/stubs/README.md`](src/services/stubs/README.md). They report
themselves honestly — `stub-lexicon-v0`, `HEURISTIC`, `source: 'DEMO'` — and the
engineering screen prints those values verbatim.

## Things that are deliberate

- **Money is paise (`amountMinor`) everywhere.** Rupees exist only in
  `utils/format.ts`, at the point of display.
- **No live "current risk" number on the home screen.** With no payment in
  progress there is nothing to score, so a number there would be invented.
  The last real check is shown instead.
- **The investigation screen paces its reveal.** The analysis finishes in
  milliseconds; the feed reveals it a line at a time so a person can follow,
  and prints the real compute time so the pacing cannot be mistaken for the
  analysis.
- **The back button cannot dismiss an intervention.** It is dismissed by making
  a decision.
- **Continuing past a critical warning takes a second, deliberate action** with
  a short delay — long enough to think, not so long it feels like a punishment.

## Tests

```
riskEngine   scoring, corroboration, degraded evidence, the false-positive cases
pipeline     scripted speech → classifier → agent → engine → policy, end to end
classifier   pressure tactics detected, friendly requests not
behaviour    the amount-anomaly curve and cold-start behaviour
store        navigation stack and the audit log
screens      every screen mounts, including empty, error and no-result states
```
