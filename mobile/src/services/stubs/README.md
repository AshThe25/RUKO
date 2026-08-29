# Stubs — temporary, and loudly labelled

Everything in this directory exists so the mobile app is a *real* running
product before the ML and Android workstreams land. Each one implements a
contract from `docs/contracts/` and is swapped out in exactly one place:
`mobile/src/services/createServices.ts`.

| Stub | Replaced by | Owner of the real thing |
| --- | --- | --- |
| `lexicalClassifier.ts` | ONNX manipulation classifier, `mobile/src/risk/` | Vedant |
| `stubRiskEngine.ts` | deterministic risk engine, `mobile/src/risk/` | Vedant |
| `stubAgent.ts` | investigation agent, `mobile/src/agent/` + `mobile/src/tools/` | Vedant |
| `deviceStubs.ts` | Android call / payment / notification providers | Puneesh |
| `guardianStub.ts` | WebSocket guardian channel | Puneesh |

## The rules these stubs follow

1. **Nothing is hardcoded to a demo outcome.** The scripted transcript really
   is scored by the lexicon, the scores really do drive the engine, and the
   engine really does compute the number the screen shows. Change a word in a
   scenario and the score moves.
2. **Every one of them reports itself honestly.** `source: 'DEMO'`,
   `backend: 'HEURISTIC'`, `modelVersion: 'stub-lexicon-v0'` — the engineering
   screen prints those verbatim. The app can never imply a trained model ran
   when one did not.
3. **They do not grow.** If a stub needs a real feature, that feature belongs
   in its owner's directory, not here.

`stubRiskEngine.ts` is deliberately the *spec's* weights and nothing more — it
is not a competing design, it is the reference table from master spec §20 so
the UI has real numbers to render until the owned implementation exists.
