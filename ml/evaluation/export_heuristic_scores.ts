#!/usr/bin/env node
/**
 * Emit the deterministic classifier's scores for every dataset row as JSON, so
 * the Python evaluation can compare and fuse it with the neural model.
 *
 *   node ml/evaluation/export_heuristic_scores.ts
 *
 * The lexicon lives in TypeScript because that is what runs on the phone.
 * Re-implementing it in Python for evaluation would create two sources of truth
 * and, inevitably, two different answers.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { scoreText } from '../../mobile/src/risk/classifier/heuristicClassifier.ts';

const SPLITS: Array<[string, string]> = [
  ['val', 'ml/data/processed/val.jsonl'],
  ['test', 'ml/data/processed/test.jsonl'],
  ['holdout', 'ml/datasets/holdout/test_holdout.jsonl'],
  // Added when the grooming/sextortion set landed; evaluate.py reads this
  // key and previously died with KeyError: 'safeguarding' because the
  // exporter was never taught about the split.
  ['safeguarding', 'ml/datasets/holdout/safeguarding_holdout.jsonl'],
];

const out: Record<string, Array<Record<string, number>>> = {};
for (const [name, path] of SPLITS) {
  if (!existsSync(path)) {
    console.error(`missing ${path}`);
    process.exit(1);
  }
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  out[name] = rows.map((r) => scoreText(r.text).scores);
  console.log(`${name}: ${rows.length} rows scored`);
}

mkdirSync('ml/data/derived', { recursive: true });
writeFileSync('ml/data/derived/heuristic_scores.json', JSON.stringify(out));
console.log('wrote ml/data/derived/heuristic_scores.json');
