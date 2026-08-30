# Handoff — fix these before testing with real calls and messages

State of `main` as of this handoff. Every number below was measured by running
the shipped artefacts, not read off a card.

## What works, and is safe to demo

- **`ruko-manip-v1`** — the six-tactic manipulation classifier. This is the
  product. Running on the iQOO 15 on NNAPI, weights committed via LFS.
  - authored-holdout macro **0.699** (ensemble int8) / 0.657 (pytorch fp32)
  - sha256 `2e30251f4a35…` matches across `ml/`, the APK asset and
    `mobile/src/risk/classifier/modelConfig.generated.ts`
  - **English call detection is good**: a bank-freeze scam with a live payment
    and an active call scores **72 → HIGH** through the full risk engine.
- Guardian console (Supabase + Realtime), spend oversight, the backend proxy.

**Green baselines — anything that changes these is a regression:**

| suite | command | baseline |
| --- | --- | --- |
| mobile typecheck | `cd mobile && npx tsc --noEmit \| wc -l` | **47 error lines** (pre-existing) |
| risk tests | `cd mobile && node --experimental-strip-types --test src/risk/__tests__/*.test.ts` | **74 pass** |
| guardian | `cd guardian && npx vitest run` | **23 pass** |
| backend | `cd backend && ./.venv/bin/python -m pytest -q` | **57 pass** |

---

## BUG 1 — Hinglish call detection under-fires (highest priority)

India's digital-arrest calls are in Hindi/Hinglish. The model is materially
worse there, and it costs a whole risk band.

```
English bank-freeze scam    -> score 72  HIGH
Hinglish digital-arrest     -> score 37  MEDIUM     <-- same scam
```

Three of eight tactics fire in English and miss the same intent in Hinglish:

| intent | English | Hinglish |
| --- | ---: | ---: |
| "you will be arrested" (coercion) | 1.00 | **0.02** |
| "tell me the OTP" (credentialRequest) | 1.00 | **0.16** |
| "send money to this UPI id" (financialInstruction) | 0.47 | **0.00** |

Reproduce: `ml/.venv/bin/python ml/evaluation/probe_hinglish_parity.py`

**Root cause is coverage, not thresholds.** `credentialRequest` had one Hinglish
template family against six English; coercion three against nine.

### The trap — read this before you retrain

Adding Hinglish families and retraining **has already been tried and it
regressed**: authored holdout **0.657 → 0.600**. It was correctly not shipped.

The reason is a measurement problem, not a modelling one: **the authored holdout
is almost entirely English.** It cannot see a Hinglish failure, and it charges
the model for capacity spent there. It will keep rejecting this fix on merit it
cannot measure.

**So do this in order:**
1. **First**, author ~30 Hinglish rows into
   `ml/datasets/holdout/test_holdout.jsonl` — real phrasings, hand-written, no
   template overlap. This is a data task.
2. **Then** add Hinglish template families and retrain.
3. Ship only if the authored-holdout macro improves on **0.699**.

Doing 2 before 1 wastes a training run. It already has.

---

## BUG 2 — the binary fraud gate is unusable on real traffic

`ruko-real-multisource-v1` is on main with real weights (22.9 MB, sha256
verified) but is **inert — nothing consumes its score**, so it cannot affect any
risk decision today. Leave it that way until this is fixed.

Measured on 95 ordinary legitimate Indian transactional SMS:

```
flagged as fraud:      90 / 95   =  94.7% false positive rate
median P(fraud):       0.9911    on text that is unambiguously legitimate
"Salary credited to your account ending 4417"  ->  0.998
```

Reproduce: `ml/.venv/bin/python ml/evaluation/probe_fraud_gate_ood.py`

**Why its reported precision of 0.9953 missed this:** its legitimate class is
UCI SMS ham (personal English chat, 2012) and call-centre transcripts; its fraud
class is real Indian smishing. Every training row mentioning an account, a rupee
amount or an OTP is fraud, so "transactional text" and "fraud" are the same
feature. Its own test split shares the blind spot and cannot detect it.

### The fix

The missing negative class is already built:
`ml/datasets/holdout/india_transactional_negatives.jsonl` (95 rows — debit and
credit alerts, OTPs with their "do not share" boilerplate, EMI and utility
reminders, deliveries, statements, refunds). Regenerate with
`ml/datasets/build_india_transactional_negatives.py`.

1. Fold those into the gate's **legitimate** class.
2. Retrain (`ml/training/train_real_binary.py` — needs the external corpora,
   which are gitignored by licence policy; Puneesh has them).
3. Re-run the probe. **The number to beat is 94.7%.** Target under 5%.
4. Only then consider wiring it — and only as bounded `notificationSuspicion`,
   capped, never able to reach CRITICAL alone. The six-tactic engine wins on
   disagreement.

**Do not wire it to notifications before this is fixed.** Notifications are bank
and transactional SMS — precisely where it fails.

---

## Rules that must hold

- **Report the authored-holdout macro, never the generated-test one.** The
  generated test is misleading; it has already caused one wrong diagnosis where
  secrecy/credentialRequest looked weak when the real weak labels were urgency
  and financialInstruction.
- **Never tune on the test split.** Validation only, for thresholds.
- **Keep `max_length=64` and the six-label output shape.** The contract, the
  ONNX graph, the risk weights, the TypeScript and the Kotlin all depend on it.
  A seventh label for sextortion is a real need but touches all four at once —
  post-demo, not now.
- **If the holdout does not improve, do not ship it.**
- **Do not quote the gate's 99.15% / 98.6%** as something the app does. It
  changes no decision and is wrong on most real traffic. The defensible number
  is **0.699**.
- After any model change, re-verify the hash chain — `ml/` vs the APK asset vs
  `modelConfig.generated.ts`. If they diverge the app silently falls back to the
  lexicon. `python3 ml/verify_model_artifacts.py` checks this.

## Before real-call testing

1. Confirm the hash chain matches (above) — otherwise you are testing the
   lexicon and will not be told.
2. Check the engineering screen reports the backend it actually got, not the one
   requested.
3. Expect Hinglish calls to under-fire until BUG 1 is fixed. Do not read that as
   the pipeline being broken — it is a known, measured coverage gap.
