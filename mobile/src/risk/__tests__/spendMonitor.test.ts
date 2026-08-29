import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADULT_POLICY,
  MINOR_POLICY,
  describeSpend,
  evaluateSpend,
  shouldNotifyGuardian,
} from '../spendMonitor.ts';
import type { TransactionRecord } from '../../contracts/index.ts';

const NOW = 1_700_000_000_000;
const min = (n: number) => n * 60_000;

const tx = (amountMinor: number, agoMinutes: number, id = String(Math.random())): TransactionRecord => ({
  id,
  payeeHash: 'hash-game-store',
  amountMinor,
  timestamp: NOW - min(agoMinutes),
});

describe('single large payment', () => {
  test('one big charge trips on its own', () => {
    const a = evaluateSpend([tx(150_000, 5)], NOW, MINOR_POLICY); // ₹1,500
    assert.ok(a.triggered);
    assert.ok(a.triggers.includes('SINGLE_LARGE_PAYMENT'));
  });

  test('a payment under the ceiling does not', () => {
    const a = evaluateSpend([tx(50_000, 5)], NOW, MINOR_POLICY); // ₹500
    assert.equal(a.triggered, false);
    assert.equal(a.band, 'LOW');
  });
});

describe('the case per-transaction limits miss', () => {
  test('six ₹500 payments cross the cumulative line', () => {
    // No single payment is remarkable. ₹3,000 is gone.
    const history = [0, 10, 20, 30, 40, 50].map((ago, i) => tx(50_000, ago, `t${i}`));
    const a = evaluateSpend(history, NOW, MINOR_POLICY);

    assert.ok(a.triggered, 'six ₹500 payments must notify');
    assert.ok(a.triggers.includes('CUMULATIVE_THRESHOLD'));
    assert.equal(a.windowTotalMinor, 300_000);
    assert.equal(a.windowCount, 6);
    // Not one of them would have tripped a single-payment limit.
    assert.equal(a.triggers.includes('SINGLE_LARGE_PAYMENT'), false);
  });

  test('spend outside the window is not counted', () => {
    const stale = [0, 1, 2, 3, 4, 5].map((i) => tx(50_000, 600 + i, `old${i}`));
    const a = evaluateSpend(stale, NOW, MINOR_POLICY);
    assert.equal(a.triggered, false);
    assert.equal(a.windowTotalMinor, 0);
  });

  test('band rises with how far past the line it is', () => {
    const light = evaluateSpend([tx(200_000, 5)], NOW, { ...MINOR_POLICY, singlePaymentMinor: 10_000_000 });
    assert.equal(light.band, 'MEDIUM'); // cumulative only, 1x over

    const heavy = evaluateSpend(
      [0, 5, 10, 15].map((a, i) => tx(200_000, a, `h${i}`)), // ₹8,000 vs ₹2,000
      NOW,
      MINOR_POLICY,
    );
    assert.equal(heavy.band, 'CRITICAL');
  });
});

describe('rapid repeats', () => {
  test('a burst of small payments notifies even when the total is modest', () => {
    const burst = [0, 2, 4, 6].map((a, i) => tx(20_000, a, `b${i}`)); // ₹200 × 4 = ₹800
    const a = evaluateSpend(burst, NOW, MINOR_POLICY);
    assert.ok(a.triggers.includes('RAPID_REPEAT_PAYMENTS'));
    // Below the cumulative ceiling — this trigger is independent of amount.
    assert.equal(a.triggers.includes('CUMULATIVE_THRESHOLD'), false);
  });
});

describe('minor vs adult policy', () => {
  test('the same spend that alerts for a child does not for an adult', () => {
    const history = [0, 10, 20].map((a, i) => tx(100_000, a, `m${i}`)); // ₹3,000
    assert.ok(evaluateSpend(history, NOW, MINOR_POLICY).triggered);
    assert.equal(evaluateSpend(history, NOW, ADULT_POLICY).triggered, false);
  });
});

describe('not spamming the parent', () => {
  test('first trigger always notifies', () => {
    const a = evaluateSpend([tx(300_000, 1)], NOW, MINOR_POLICY);
    assert.ok(shouldNotifyGuardian(a, null, null, NOW, MINOR_POLICY));
  });

  test('inside the cooldown at the same band, it stays quiet', () => {
    const a = evaluateSpend([tx(300_000, 1)], NOW, MINOR_POLICY);
    const justNotified = NOW - min(5);
    assert.equal(shouldNotifyGuardian(a, justNotified, a.band, NOW, MINOR_POLICY), false);
  });

  test('but an escalation breaks through the cooldown', () => {
    const a = evaluateSpend([tx(600_000, 1)], NOW, MINOR_POLICY);
    assert.equal(a.band, 'CRITICAL');
    const justNotified = NOW - min(5);
    assert.ok(
      shouldNotifyGuardian(a, justNotified, 'MEDIUM', NOW, MINOR_POLICY),
      'a situation that got worse must not be silenced by the cooldown',
    );
  });

  test('after the cooldown it notifies again', () => {
    const a = evaluateSpend([tx(300_000, 1)], NOW, MINOR_POLICY);
    const old = NOW - min(MINOR_POLICY.cooldownMinutes + 1);
    assert.ok(shouldNotifyGuardian(a, old, a.band, NOW, MINOR_POLICY));
  });

  test('nothing triggered means nothing sent', () => {
    const a = evaluateSpend([tx(1_000, 1)], NOW, MINOR_POLICY);
    assert.equal(shouldNotifyGuardian(a, null, null, NOW, MINOR_POLICY), false);
  });
});

describe('what the parent reads', () => {
  test('the cumulative case names the count, not just the total', () => {
    const history = [0, 10, 20, 30, 40, 50].map((a, i) => tx(50_000, a, `d${i}`));
    const text = describeSpend(evaluateSpend(history, NOW, MINOR_POLICY), MINOR_POLICY);
    assert.match(text, /₹3,000/);
    assert.match(text, /6 payments/);
  });

  test('a single charge reads as a single charge', () => {
    const text = describeSpend(evaluateSpend([tx(250_000, 2)], NOW, MINOR_POLICY), MINOR_POLICY);
    assert.match(text, /single payment of ₹2,500/);
  });
});
