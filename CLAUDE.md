# Ruko — project instructions

Read this before touching anything. It is the standing brief for every Claude
Code session in this repo, including sessions started from the phone.

## What Ruko is

An on-device Android safety layer that detects when someone is being
**manipulated into making a payment**, and intervenes before the money moves.

> Traditional fraud systems ask whether a transaction is suspicious.
> Ruko asks whether the person is being manipulated into making the transaction.

Not a chatbot. Not an LLM wrapper. Not a dashboard.

## The one architectural rule

**AI gathers and interprets evidence. A deterministic engine decides what to do.**

No model, agent or LLM ever emits a decision. The classifier produces
`ConversationEvidence`; the agent gathers `RiskEvidence`; a versioned,
unit-tested risk engine turns that into a `RiskResult`; a policy maps the
result to a user-visible action. Anything that shortcuts this is wrong.

## Ownership — do not work outside your lane

| Owner | Branch | Directories |
| --- | --- | --- |
| Aishwarya | `feature/aishwarya-ui` | `mobile/src/{screens,components,services,store,theme,types,utils,navigation}` |
| Vedant | `feature/vedant-ml` | `ml/`, `mobile/src/{risk,agent,tools}` |
| Puneesh | `feature/puneesh-native` | `mobile/android/`, `guardian/`, `backend/` |

Shared: `docs/contracts/` — the only coupling between workstreams.

Never push to `main`. Never edit another owner's directory. Before starting:

```bash
git fetch origin && git status
```

If someone else has pushed, read their work and adapt to it rather than
replacing it.

## Changing a shared contract

1. Edit the file in `docs/contracts/`.
2. Add an entry to `docs/contracts/CHANGELOG.md`.
3. Tell the team.
4. Additive (new optional field) is always safe. Renaming or removing is not.

Missing evidence is a first-class state: every evidence type carries
`available`. `0` means "measured, and absent". Unavailable means "we do not
know". They are never the same thing.

## Honesty rules — these are not negotiable

- **Never hardcode a number the app displays.** If a screen shows `91`, the
  risk engine computed `91` from evidence that was actually gathered.
- **Never claim NPU/NNAPI acceleration that has not been measured.** The
  engineering screen reports the backend the runtime actually returned,
  including `HEURISTIC` and `UNAVAILABLE`.
- **Never present a stub as real.** Stubs live in
  `mobile/src/services/stubs/`, report `source: 'DEMO'` or
  `'ON_DEVICE_HEURISTIC'`, and say so in the UI.
- **Never fake Android capability.** A normal third-party app cannot intercept
  arbitrary UPI payments. Payment context comes from an AccessibilityService
  where a screen exposes readable nodes, or from RukoPayDemo. Say so.
- Demo Mode runs the real pipeline on scripted input. It never short-circuits
  to a result.

## Product rules

- Ruko is quiet until it matters. Low risk = no interruption.
- Never block money without a user-facing explanation of what was detected and
  why it matters.
- Primary CTA at critical risk is **DON'T PAY**. Continuing is possible but
  deliberate.
- Never shame the user. "You may be under pressure", never "you are being
  stupid".
- The phone works alone. No internet, no laptop, no Office Kit, no cloud —
  core protection still runs.

## Commands

```bash
cd mobile && npm install     # once
npm start                    # metro bundler
npm run android              # build + install on the connected iQOO 15
npm test                     # jest
npx tsc --noEmit             # typecheck
npm run lint
```

## Commit style

`feat(mobile): add investigation flow`, `fix(risk): ...`, `docs(contracts): ...`

Do not add `Co-Authored-By` lines.
