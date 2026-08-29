# Ruko Guardian (`guardian/`)

The Office Kit surface. **Owner: Puneesh.**

## What it is

A trusted person's control surface for one moment: a payment Ruko has already
paused on someone's phone, and the decision about whether to release it.

It is deliberately **not a dashboard**. There are no charts, no counters, no
activity feed, and nothing to monitor. It has three states:

1. **Pair** — enter the six-digit code the phone is showing.
2. **Quiet** — "Nothing needs your attention." This is where it lives 99% of
   the time, and it is meant to be boring.
3. **Critical** — one payment, one score, three reasons, two buttons.

## What the guardian can and cannot see

| Sees | Never sees |
| --- | --- |
| Amount and payee display name | The conversation or any transcript |
| Risk score, level, three reasons | Audio, in any form |
| Which model and compute backend ran | The payee's UPI ID or account number |
| Whether it is a first payment | Location, contacts, notification bodies |

The relay enforces this — a payload carrying a `payeeId` is rejected before it
reaches the browser, and `backend/tests/test_contract_parity.py` fails the
build if anyone adds a field that would widen this table.

## Design decisions worth knowing

- **"Keep it blocked" is the primary button.** Releasing money is the
  irreversible direction, so it is the quiet secondary action and takes a
  second, deliberate confirmation step with a warning about verifying through a
  channel the caller did not supply.
- **Doing nothing is safe.** The panel says so explicitly. A guardian who is
  confused or panicking should not have to act correctly under pressure.
- **Unmeasured latency renders as `—`.** Never `0 ms`, never a plausible guess.
  `formatLatency(null)` has a test.
- **Every inbound frame is validated at runtime** before anything is rendered.
  A frame that fails is dropped and counted, and the count is surfaced — a
  protocol mismatch shows up as a visible message rather than a blank panel.
- **A 4401 close does not trigger reconnection.** A dead token means the
  pairing is over; retrying would just hammer the relay.
- **The connection pill describes the phone, not the browser.** That is the
  only connection state a trusted person actually cares about.

## Running it

```bash
cd guardian
npm install
cp .env.example .env.local
npm run dev
```

The relay must be running (see `backend/README.md`), and its
`RUKO_ALLOWED_ORIGINS` must include this console's origin.

## Checks

```bash
npm run lint   # tsc --noEmit
npm test       # vitest
npm run build
```

## Verified end to end

On 2026-08-29, against a live relay: paired with a real six-digit code,
received a `RISK_ALERT` over a real websocket, rendered the critical panel, sent
`KEEP_BLOCKED`, and confirmed the phone client received the decision.
`scripts/e2e-relay.py` replays that whole path headlessly as a regression check.
