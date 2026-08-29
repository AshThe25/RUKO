# Ruko manipulation-signal dataset — `ruko-manip-ds-v1`

## What this is

Short conversation windows (roughly what one 6–10 second ASR window produces),
labelled with **six manipulation tactics**, multi-label:

| Label | Meaning |
|---|---|
| `authority` | The speaker asserts institutional authority over the listener. |
| `coercion` | Threat of loss: account freeze, arrest, disconnection, legal case. |
| `urgency` | Time pressure; "right now"; "do not disconnect". |
| `financialInstruction` | An instruction to the listener to move money. |
| `secrecy` | Instruction to conceal the interaction from others. |
| `credentialRequest` | Asking for OTP / PIN / CVV / card number, or remote device access. |

### Important: `authority` is a *claim*, not proof of impersonation

No model can verify a caller's identity from speech. A genuine call from a bank
and an impersonated one are acoustically and lexically identical. So this label
means "the speaker asserts institutional authority", and genuine bank calls in
the SAFE portion of the data carry it too. It becomes risk **only** when the
deterministic risk engine fuses it with coercion, a payment instruction, and
payment context. Labelling it "impersonation" would have been dishonest and
would have taught the model to flag every real customer-service call.

## How it is built

`ml/datasets/templates.py` defines 56 **families**. A family is one
conversational archetype ("caller claims to be from a bank", "friend asks to
split dinner"). `ml/datasets/generate.py` composes 1–3 utterances from families
of the same kind into a window, fills slots from `ml/datasets/slots.py`, and
applies ASR-style surface processing.

### Splits are disjoint by family, not by row

This is the single most important property. Randomly splitting rows would put
slot-variants of training rows into the test set, and the reported F1 would
measure memorisation. Whole families are assigned to exactly one split,
stratified so every split covers every tactic and both kinds (scam / safe).
The generator hard-fails if a split loses a kind, and asserts that no exact text
string appears in two splits.

### ASR realism

Input at inference time comes from on-device speech recognition, so every
example is lowercased, stripped of punctuation, and passed through a seeded
noise model: ~2% word drop, ~1% stutter, 25% chance of an inserted disfluency
(`uh`, `haan ji`, `matlab`). Amounts are rendered as digits or as spoken words
with equal probability, because ASR produces both.

## The hand-authored holdout

`ml/datasets/holdout/test_holdout.jsonl` (107 rows) was written by hand and
shares **no templates at all** with the generator. The generated test split
still shares a *style* with training data, so its score is optimistic. **The
holdout number is the honest number and both are always reported.** The gap
between them is the measured cost of training on synthetic data.

## Composition (seed 20260829)

| Split | Rows | Families | All-zero rows | Languages |
|---|---|---|---|---|
| train | 6000 | 37 | 708 | en 3509 / hinglish 2491 |
| val | 1200 | 9 | 49 | en 937 / hinglish 263 |
| test | 1200 | 10 | 46 | en 966 / hinglish 234 |
| holdout | 107 | hand-authored | 20 | en 89 / hinglish 18 |

Exact per-label counts and the sha256 of every file are in `ml/data/manifest.json`.

## Reproducing

```bash
python3 ml/datasets/holdout/author_holdout.py
python3 ml/datasets/generate.py --out ml/data --seed 20260829
```

Same seed produces byte-identical files. `ml/data/` is generated, not committed;
the generator and the hand-authored holdout are committed.

## Provenance and ethics

**Every example is synthetic or hand-authored. No real person's conversation was
collected, recorded, scraped or used.** Scam phrasing is drawn from patterns that
are widely documented in public fraud-awareness material (KYC expiry, digital
arrest, courier/customs, refund reversal, remote-access support). Institution
names are public; personal names are common given names used as slot fillers and
refer to no one.

## Known limitations

1. **Synthetic data has a ceiling.** Real scam calls are longer, more
   improvisational, and contain rapport-building the templates do not model.
   The holdout partially probes this; it does not remove the limitation.
2. **Roman-script only.** English and romanised Hinglish. Devanagari is out of
   scope for v1 because it needs a multilingual tokenizer roughly 5× larger,
   which conflicts with the on-device size budget. Deferred to a Sarvam-backed
   path.
3. **Windows, not dialogue.** The classifier sees a window, not turn structure
   or speaker diarisation. Who said what is not modelled.
4. **Label correlation.** Scam families co-occur by construction (authority
   with coercion, etc.), so the model may over-couple them. This is exactly why
   the risk engine weights them separately and requires corroboration from
   independent evidence families before escalating.
5. **Class balance is not natural.** ~67% of generated windows are scam-kind.
   Real call audio is overwhelmingly benign. Thresholds are therefore calibrated
   on the validation split rather than left at 0.5, and the operating point is
   chosen for precision.
