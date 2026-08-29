# Ruko relay (`backend/`)

> **Status: two things live here.** Guardian alerting moved to Supabase
> (Postgres + RLS + Realtime); see `guardian/`. The WebSocket relay documented
> further down is no longer on the alert path but is retained and still green.
> The service's active job is now the **API-key proxy** described immediately
> below.

## The API-key proxy

### Why it exists

An APK is a zip file. `apktool d app.apk` recovers embedded strings in about a
minute, so any vendor key shipped inside the app is a public key with extra
steps — and a leaked key is someone else's bill and someone else's abuse.

So the phone holds no Sarvam or Anthropic key. It calls these two endpoints with
the Supabase access token it already has from signing in, and the keys exist only
in this process's environment.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/transcribe` | Supabase JWT | Audio to text via Sarvam Saarika. |
| `POST` | `/explain` | Supabase JWT | One plain-language explanation per alert. |

### Identity

There is no second auth scheme here — no enrolment, no key issuing, no session of
its own. The proxy verifies the Supabase JWT against the project's own signing
keys, supporting both shapes a project can be in:

- **asymmetric (ES256/RS256)** against the published JWKS. The default for
  current projects, and no shared secret is needed here.
- **symmetric (HS256)** with `RUKO_SUPABASE_JWT_SECRET`, for legacy projects.

Rejected: unsigned, expired, wrong-audience, `service_role`, and **anonymous**
sessions. Anonymous matters because a Supabase anonymous user still carries
`role: authenticated` — `is_anonymous` is what actually separates "someone
signed in" from "anyone at all". Every failure returns the same body, so the
endpoint cannot be used as an oracle.

### Cost control

`/explain` is idempotent per `alert_id`. The first call buys a completion; every
repeat returns the stored text with `"cached": true`. A phone retrying after a
dropped connection cannot quietly bill twice. The cache is in-process, so a cold
start can cost one extra completion — the failure mode is a duplicate spend, not
a wrong answer, which is why this is not a database.

### What may be sent

`/explain` accepts the *facts of an alert* — band, score, reason codes, amount,
payee, kind — and **rejects anything else with a 422**, including `transcript`,
`text`, `audio` and `message_body`. Ruko's promise is that what was said stays on
the device, and an explanation is built from the reason codes the on-device
engine already produced. The prompt also instructs the model not to imply it
heard the conversation.

`/transcribe` is a pass-through: audio is streamed to the vendor and dropped. It
is capped (`RUKO_MAX_AUDIO_BYTES`) because Saarika takes utterances, not whole
calls, and an uncapped upload endpoint is a file host. Nothing is written down.

> If the product later wants transcript text in `/explain`, that is a deliberate
> change to the privacy promise and should be argued for — not enabled by
> loosening a schema.

### Deploying

`render.yaml` is a Render blueprint. Every key is `sync: false`, so Render
prompts for it in the dashboard and it never enters this repository.


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
