import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildProfile, evaluateBehaviour, seedHistory } from '../behaviourEngine.ts';
import { buildPayeeIndex, evaluatePayee } from '../payeeEngine.ts';
import { MIN_PROFILE_SAMPLE } from '../weights.ts';

const NOW = Date.UTC(2026, 7, 29, 14, 0, 0);
const EVERYDAY = [300_00, 450_00, 1200_00, 800_00, 2100_00, 550_00, 900_00, 1500_00,
  420_00, 780_00, 250_00, 1100_00];

describe('behaviour profile', () => {
  test('an empty history is not mature and claims nothing', () => {
    const p = buildProfile([], NOW);
    assert.equal(p.mature, false);
    assert.equal(p.medianAmountMinor, null);
    const e = evaluateBehaviour(p, 48_000_00, NOW);
    assert.equal(e.amountAnomaly, 0);
    assert.equal(e.profileMature, false);
    assert.ok(e.unavailableReason);
  });

  test(`a profile becomes mature at ${MIN_PROFILE_SAMPLE} transactions`, () => {
    const just_under = buildProfile(seedHistory(EVERYDAY.slice(0, MIN_PROFILE_SAMPLE - 1), ['a'], NOW), NOW);
    const just_over = buildProfile(seedHistory(EVERYDAY.slice(0, MIN_PROFILE_SAMPLE), ['a'], NOW), NOW);
    assert.equal(just_under.mature, false);
    assert.equal(just_over.mature, true);
  });

  test('a large payment against a small history is a strong anomaly', () => {
    const p = buildProfile(seedHistory(EVERYDAY, ['a', 'b'], NOW), NOW);
    const e = evaluateBehaviour(p, 48_000_00, NOW);
    assert.equal(e.available, true);
    assert.ok((e.amountRatio ?? 0) > 10);
    assert.equal(e.amountAnomaly, 1);
  });

  test('a payment inside the normal range is not an anomaly', () => {
    const p = buildProfile(seedHistory(EVERYDAY, ['a'], NOW), NOW);
    assert.equal(evaluateBehaviour(p, 900_00, NOW).amountAnomaly, 0);
  });

  test('p95 is the reference, so a routine large payment stays moderate', () => {
    // Someone who regularly pays rent has large payments in their history.
    const withRent = [...EVERYDAY, 50_000_00, 50_000_00, 50_000_00, 50_000_00];
    const p = buildProfile(seedHistory(withRent, ['landlord'], NOW), NOW);
    const e = evaluateBehaviour(p, 50_000_00, NOW);
    assert.ok(e.amountAnomaly < 0.2,
      `rent should look ordinary for this user, got ${e.amountAnomaly}`);
  });

  test('no current amount means unavailable, not zero risk', () => {
    const p = buildProfile(seedHistory(EVERYDAY, ['a'], NOW), NOW);
    const e = evaluateBehaviour(p, null, NOW);
    assert.equal(e.available, false);
    assert.ok(e.unavailableReason);
  });
});

describe('payee index', () => {
  const history = seedHistory(EVERYDAY, ['friend', 'landlord'], NOW);
  const index = buildPayeeIndex(history, new Set(['landlord']));

  test('aggregates prior payments per payee', () => {
    const e = evaluatePayee(index, 'friend', NOW);
    assert.equal(e.known, true);
    assert.equal(e.previousTransactions, 6);
    assert.ok((e.ageDays ?? 0) > 0);
  });

  test('honours the user trust flag', () => {
    assert.equal(evaluatePayee(index, 'landlord', NOW).userTrusted, true);
    assert.equal(evaluatePayee(index, 'friend', NOW).userTrusted, false);
  });

  test('an unseen payee is known:false but still available', () => {
    const e = evaluatePayee(index, 'stranger', NOW);
    assert.equal(e.available, true);
    assert.equal(e.known, false);
    assert.equal(e.previousTransactions, 0);
  });

  test('a null hash is unavailable, NOT a new payee', () => {
    const e = evaluatePayee(index, null, NOW);
    assert.equal(e.available, false);
    assert.equal(e.known, false);
    assert.ok(e.unavailableReason);
  });
});
