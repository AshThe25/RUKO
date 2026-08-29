# Ruko relay (`backend/`)

> **Status: superseded, kept running.** Guardian alerting has moved to Supabase
> (Postgres + RLS + Realtime); see `guardian/`. The WebSocket relay below is no
> longer on the alert path. It is retained, tested and green while the intended
> replacement — a thin API-key proxy — is specified with Aishwarya. Nothing here
> has been deleted, and none of its behaviour has changed.

FastAPI service that connects a Ruko phone to a trusted person's Guardian
console. **Owner: Puneesh.**

## What it is not

This is the least intelligent part of Ruko, on purpose. It performs no
inference, computes no risk score, stores no evidence, and keeps nothing after
a session ends. If it goes down, every phone keeps protecting its user — only
the Guardian escalation path is lost.

Everything that decides anything runs on the phone.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/devices/register` | none | Phone gets a device id + token. |
| `POST` | `/guardian/pair` | `Bearer deviceToken` | Phone gets a 6-digit code to read aloud. |
| `POST` | `/guardian/pair/claim` | none | Guardian console redeems the code for a session token. |
| `POST` | `/risk-events` | `Bearer deviceToken` | Opt-in anonymous telemetry. |
| `GET` | `/models/latest` | none | Published model metadata, or 404 if none. |
| `WS` | `/guardian/{sessionId}?token=…` | token | The relay socket. |
| `GET` | `/health` | none | Liveness. |

## Security properties

These are enforced in code and covered by tests:

- **Two-step pairing.** The phone requests a code; the Guardian redeems it.
  There is no long-lived shared secret, and the Guardian's token is scoped to
  one session — it is useless on any other.
- **Single-use codes.** A code is burned on claim, and requesting a new one
  invalidates the previous one. An expired code and a wrong code return the
  same 404, so the endpoint cannot be used as an oracle.
- **Role enforcement.** The `ORIGINATOR` map decides who may send what. A
  Guardian cannot forge a `RISK_ALERT`; a phone cannot approve its own payment.
- **One decision per incident.** The check and write happen under one lock, so
  two rapid clicks cannot both win.
- **Unknown fields are rejected** at every boundary. A payload trying to smuggle
  `payeeId`, a transcript or an amount into telemetry is refused, not ignored.
- **Constant-time token comparison**, so signatures cannot be probed by timing.

Tokens are HMAC-SHA256 over `role:subject:issuedAt` — small on purpose. There
is no session lookup on the hot path and nothing sensitive inside the token.

## What never crosses this service

Raw audio, transcripts, the payee's VPA or account number, notification
bodies, and location. The Guardian sees a display name, an amount, a score and
three plain-language reasons. `test_contract_parity.py` fails the build if
anyone adds a field that would change that.

## Running it

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env   # then set RUKO_RELAY_SECRET
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Generate a secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Interactive API docs are at `http://localhost:8000/docs`.

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
```

43 tests covering pairing, the relay socket, role enforcement, incident
integrity, protocol hardening and TypeScript↔Python contract parity.

## Production notes

Not yet done, and not pretended otherwise:

- Terminate TLS in front of this and set `RUKO_ALLOW_INSECURE_TRANSPORT=false`.
  The contract specifies `wss://`; local development uses `ws://`.
- `RUKO_RELAY_SECRET` must be set explicitly; the app refuses to start in
  production without it. In development it generates a per-process secret,
  which invalidates all tokens on restart — the safe direction to fail.
- Sessions live in process memory. Multiple replicas would need a shared
  registry; for the hackathon a single instance is correct and simpler.
- `/risk-events` validates and drops. Wiring it to storage needs an explicit
  consent flow and a retention policy first, not a quiet `INSERT`.
