/**
 * Evaluate the deterministic fallback classifier on the real dataset.
 *
 *   node ml/evaluation/evaluate_heuristic.ts
 *
 * WHY: the heuristic is the baseline the trained model has to beat. If a 23 MB
 * transformer does not clearly outperform a 200-line regex table on the
 * hand-authored holdout, the transformer does not ship — it is pure cost. This
 * script produces the number that decides that.
 *
 * Reported on two sets:
 *   test     generated, family-disjoint from training. Optimistic: same style.
 *   holdout  hand-authored, no template overlap. The honest number.
 */

import { readFileSync, existsSync } from 'node:fs';
import { scoreText } from '../../mobile/src/risk/classifier/heuristicClassifier.ts';
import type { ManipulationLabel } from '../../mobile/src/contracts/index.ts';

const LABELS: ManipulationLabel[] = [
  'authority', 'coercion', 'urgency', 'financialInstruction', 'secrecy', 'credentialRequest',
];
const THRESHOLD = 0.5;

interface Row { text: string; labels: Record<string, number>; lang: string; kind: string }

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

interface Counts { tp: number; fp: number; fn: number; tn: number }

function evaluate(rows: Row[]) {
  const counts: Record<string, Counts> = {};
  for (const l of LABELS) counts[l] = { tp: 0, fp: 0, fn: 0, tn: 0 };

  for (const row of rows) {
    const { scores } = scoreText(row.text);
    for (const l of LABELS) {
      const predicted = scores[l] >= THRESHOLD;
      const actual = row.labels[l] === 1;
      if (predicted && actual) counts[l].tp++;
      else if (predicted && !actual) counts[l].fp++;
      else if (!predicted && actual) counts[l].fn++;
      else counts[l].tn++;
    }
  }
  return counts;
}

function prf(c: Counts) {
  const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function report(name: string, rows: Row[]) {
  const counts = evaluate(rows);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${name}  (${rows.length} rows, threshold ${THRESHOLD})`);
  console.log('='.repeat(74));
  console.log('label                 precision  recall      F1     TP    FP    FN    TN');
  console.log('-'.repeat(74));

  let microTp = 0, microFp = 0, microFn = 0, macroF1 = 0;
  for (const l of LABELS) {
    const c = counts[l];
    const { precision, recall, f1 } = prf(c);
    microTp += c.tp; microFp += c.fp; microFn += c.fn;
    macroF1 += f1;
    console.log(
      `${l.padEnd(20)} ${precision.toFixed(3).padStart(9)} ${recall.toFixed(3).padStart(7)} ` +
      `${f1.toFixed(3).padStart(7)} ${String(c.tp).padStart(6)} ${String(c.fp).padStart(5)} ` +
      `${String(c.fn).padStart(5)} ${String(c.tn).padStart(5)}`,
    );
  }
  const micro = prf({ tp: microTp, fp: microFp, fn: microFn, tn: 0 });
  console.log('-'.repeat(74));
  console.log(`macro F1 ${(macroF1 / LABELS.length).toFixed(3)}   `
    + `micro P ${micro.precision.toFixed(3)}  R ${micro.recall.toFixed(3)}  F1 ${micro.f1.toFixed(3)}`);

  // Exact-set accuracy: every one of the six labels correct simultaneously.
  // Brutal, and the closest single number to "did it understand the window".
  let exact = 0;
  for (const row of rows) {
    const { scores } = scoreText(row.text);
    if (LABELS.every((l) => (scores[l] >= THRESHOLD) === (row.labels[l] === 1))) exact++;
  }
  console.log(`exact-match (all 6 labels right): ${exact}/${rows.length} = ${(exact / rows.length * 100).toFixed(1)}%`);

  // The safety-critical number: how often do we fire on a genuinely safe window?
  const safeRows = rows.filter((r) => r.kind === 'safe');
  const falseAlarms = safeRows.filter((r) => {
    const { scores } = scoreText(r.text);
    return LABELS.some((l) => scores[l] >= THRESHOLD && r.labels[l] !== 1);
  }).length;
  console.log(`false alarms on safe windows: ${falseAlarms}/${safeRows.length} = `
    + `${(falseAlarms / Math.max(1, safeRows.length) * 100).toFixed(1)}%`);
  return { macroF1: macroF1 / LABELS.length, microF1: micro.f1 };
}

const testPath = 'ml/data/processed/test.jsonl';
const holdoutPath = 'ml/datasets/holdout/test_holdout.jsonl';

if (!existsSync(testPath)) {
  console.error(`missing ${testPath} — run: python3 ml/datasets/generate.py --out ml/data`);
  process.exit(1);
}

console.log('Ruko deterministic fallback classifier — ruko-heuristic-v1');
const gen = report('GENERATED TEST SPLIT (optimistic: shares style with training)', load(testPath));
const hold = report('HAND-AUTHORED HOLDOUT (honest: no template overlap)', load(holdoutPath));

console.log(`\n${'='.repeat(74)}`);
console.log(`Generalisation gap (macro F1): ${gen.macroF1.toFixed(3)} generated -> `
  + `${hold.macroF1.toFixed(3)} authored  (${((hold.macroF1 - gen.macroF1) * 100).toFixed(1)} pts)`);
console.log('This is the baseline the trained model must beat on the AUTHORED set.');
console.log('='.repeat(74));
