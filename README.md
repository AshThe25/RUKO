# Ruko

**Fraud systems ask whether a transaction is suspicious. Ruko asks whether the
person is being manipulated into making it.**

A user can be on their own phone, in their own UPI app, correctly authenticated,
entering their own PIN, voluntarily approving a payment — and still be getting
scammed. Ruko is an on-device safety layer that reads the *context around the
payment* and intervenes before the money moves.

> Status: early development for the iQOO Hackathon. This README is a skeleton;
> each section is filled in by the owner of that area as it lands. Nothing here
> claims a capability that has not been built and measured.

## Repository layout

```
docs/contracts/   shared TypeScript interfaces — the only coupling between us
ml/               datasets, training, evaluation, export, benchmarks   (Vedant)
mobile/           React Native app                                     (Aishwarya)
mobile/src/risk/  behaviour engine + deterministic risk engine         (Vedant)
mobile/src/agent/ the single investigation agent                       (Vedant)
mobile/src/tools/ evidence-gathering tools                             (Vedant)
android/          native services, audio, accessibility, AI runtime    (Puneesh)
guardian/         Office Kit web app                                   (Puneesh)
backend/          thin FastAPI relay                                   (Puneesh)
```

## Team and branches

| Owner | Branch | Directories |
|---|---|---|
| Aishwarya | `feature/aishwarya-ui` | `mobile/` (screens, components, state) |
| Vedant | `feature/vedant-ml` | `ml/`, `mobile/src/{risk,agent,tools}` |
| Puneesh | `feature/puneesh-native` | `android/`, `guardian/`, `backend/` |

No direct pushes to `main`. Work on your branch, open a PR.
**Read `docs/contracts/README.md` before you write any integration code.**

## Sections still to be written

- Architecture diagram · AI architecture · On-device inference and measured
  benchmarks · Privacy model · Android capability limitations · Office Kit setup
  · Run instructions · Model training and evaluation methodology · Demo script ·
  Known limitations.
