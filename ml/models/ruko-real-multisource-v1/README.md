# Ruko Real Multisource v1

Status: **research candidate; not shipped in the app.**

This is a binary, on-device-oriented fraud/manipulation text gate. It is not a
replacement for Ruko's existing six-tactic classifier and it does not make a
payment decision by itself.

## What is in this directory

- `metrics.json` is the generated, locked test report and complete data
  provenance.
- `external_india_smishing.json` is a never-trained-on, positives-only stress
  test on real India-associated reported smishing messages.
- The PyTorch checkpoint is deliberately not committed. The repository-wide
  policy excludes checkpoints, and one source is licensed for local research
  and model development rather than public redistribution.

No raw transcript or message text is committed in this branch.

## Data integrity

All fine-tuning input was human-origin source data. No templates, LLM outputs,
translations, or paraphrases were used. The builders record input checksums,
source licences, deterministic group splits, and the exact-window leakage
check in `metrics.json`.

The India-associated IMC'25 rows were excluded before training and used only
for the external stress test. That set contains positives only, so its result
is sensitivity—not accuracy or F1.

## Reproduce locally

Obtain the permitted source datasets locally, then build and train without
committing raw data:

```bash
ml/.venv/bin/python ml/datasets/build_real_multisource_corpus.py \
  --ftc-csv /path/metadata.csv \
  --ncsu-sms-csv /path/phishing_messages.csv \
  --imc-csv /path/final_dataset_output.csv \
  --callcenter-dir /path/callcenter-json \
  --uci-sms /path/SMSSpamCollection \
  --out ml/data/real-multisource

ml/.venv/bin/python ml/training/train_real_binary.py \
  --data ml/data/real-multisource \
  --out ml/models/ruko-real-multisource-v1
```

Run `ml/evaluation/evaluate_real_india_smishing.py` only after training. It
does not fit a threshold or change the model.

## Product boundary

The model gives a fraud-likelihood signal from text available to the app. A
deterministic Ruko risk engine must combine it with consented call/audio and
payment context before an intervention. It cannot authenticate a caller or
promise detection of every scam call.
