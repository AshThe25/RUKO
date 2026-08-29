# Contract reconciliation — two independent v1s exist

**Status: OPEN. Needs a team decision. Nobody should build more integration code
until this is closed.**

## What happened

`docs/contracts/` was written twice, in parallel, before either of us saw the
other's work:

- `main` (`95c0d0f`) — contracts-v1 by Vedant. Consumed today by the risk
  engine, behaviour engine, payee engine and 60 passing tests.
- `feature/puneesh-android-guardian` — a parallel contracts-v1 by Puneesh, on a
  **disjoint root commit** (no shared history with `main` at all). Consumed by
  the FastAPI relay and the Android capability work.

Both are good. They are ~80% semantically identical and differ in shape. This
document proposes how to merge them. **No changes have been made to anyone's
branch** — this is a proposal, not an action.

## Differences that matter

| Topic | `main` (Vedant) | Puneesh's | Proposed resolution |
|---|---|---|---|
| Conversation scores | nested `scores: {authority, ...}` | flat `{authority, ...}` on the type | **Nested.** Lets the six model outputs be passed around, iterated and versioned as one unit; the risk engine already iterates them. |
| Missing evidence | `EvidenceBase.available` + `unavailableReason` on every block | not modelled | **Keep `available`.** This is load-bearing: the engine must distinguish "measured zero" from "unknown", and does so in seven places. Without it an unreadable payment screen reads as a safe payment. |
| Money | `amountMinor`, integer **paise** | `amount`, integer **rupees** | **Paise.** UPI settles in paise; rupee-only silently truncates and the bug is invisible until a demo. |
| Timestamps | epoch ms (`number`) | ISO 8601 (`string`) | **Epoch ms internally**, ISO at the wire boundary only (guardian alerts, backend). Arithmetic on ISO strings is where date bugs live. |
| Weights | 117, clamped to 100, engine-owned | `RISK_WEIGHTS` const summing to 100, exported for the Guardian UI | **Engine-owned, but export it.** Puneesh is right that the Guardian must render a truthful contribution bar — that is exactly what `RiskResult.contributions` is for. The Guardian should read per-decision contributions, not re-derive from a weight table, so the bar can never disagree with the score. |
| Enum casing | `UPPER_SNAKE` | `lower_snake` | **`UPPER_SNAKE`**, matching the level and action enums both of us already wrote that way. |
| `RiskComponent.explanation` | not present | present | **Adopt Puneesh's.** A per-decision plain-language explanation string is better than the UI re-deriving copy from a code. Being added to `RiskReason`. |
| `PROTOCOL_VERSION` | `CONTRACTS_VERSION` | `PROTOCOL_VERSION` | Either; pick one name and delete the other. |
| Speech provider types | not present | present, good | **Adopt as-is.** ASR transport is Puneesh's area. |

## Proposed process

1. Agree the table above (or amend it) — 10 minutes, all three of us.
2. Vedant lands the merged contracts on `main` in one commit, crediting both.
3. Everyone rebases onto the new `main`.

## The history problem, separately

Two branches currently cannot merge into `main` cleanly:

- **`feature/aishwarya-ui`** was branched from `56550e1`, which no longer exists
  after `main` was rewritten to strip an unwanted commit trailer. Her work is
  intact; only the base moved. Fix (run on her branch, one commit to replay):

      git fetch origin
      git rebase --onto origin/main 56550e1 feature/aishwarya-ui

- **`feature/puneesh-android-guardian`** has its own root commit and shares no
  history with `main`. This is independent of the rewrite. Fix:

      git fetch origin
      git rebase --onto origin/main --root feature/puneesh-android-guardian

  Expect conflicts in `docs/contracts/` and `.gitignore`; resolve them using the
  decisions from the table above.

Neither command has been run by anyone but the branch owner, and neither should
be.
