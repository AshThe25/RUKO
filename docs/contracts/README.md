# Ruko shared contracts

These files are the **only** coupling between the three workstreams. Everything
else is private to its owner's directory.

| File | Produced by | Consumed by |
|---|---|---|
| `conversation.schema.ts` | ML (Vedant) — local classifier | Risk engine, Investigation UI |
| `payment.schema.ts` | Android (Puneesh) — accessibility / demo payment provider | Risk engine, Mobile UI |
| `risk.schema.ts` | Risk engine (Vedant) | Mobile UI (Aishwarya), Guardian (Puneesh) |
| `investigation.schema.ts` | Agent (Vedant) | Live investigation UI (Aishwarya) |
| `guardian.schema.ts` | Backend / Office Kit (Puneesh) | Mobile UI, Risk policy |

## Rules

1. **Code against these types, not against each other's implementations.**
2. Changing a contract is a three-step process: update the file, add an entry to
   `CHANGELOG.md` in this directory, and tell the team. Do not silently rename.
3. Additive changes (new optional field) are always safe. Removing or renaming a
   field is a breaking change and needs coordination.
4. Every evidence type carries an `available` flag. **Missing evidence is a
   first-class state** — it must never be silently coerced to `0`, because `0`
   means "measured, and it is absent", while unavailable means "we do not know".
   The risk engine treats these completely differently.
5. All scores in the range `0..1` are `Confidence`. All risk scores are `0..100`.

## Versioning

Contract version: `contracts-v1`. Exported as `CONTRACTS_VERSION`.
