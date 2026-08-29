import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINOR_POLICY,
  evaluateSpend,
  shouldNotifyGuardian,
} from '../../../risk/spendMonitor.ts';

const now = Date.now();
const tx = (rupees: number, minutesAgo: number, i: number) => ({
  id: `t${i}`,
  payeeHash: 'game_store',
  amountMinor: rupees * 100,
  timestamp: now - minutesAgo * 60_000,
});

test('six 500-rupee payments trip the cumulative line for a child', () => {
  // The case a per-transaction cap never sees: no single payment is large.
  const history = [0, 5, 12, 20, 31, 44].map((m, i) => tx(500, m, i));
  const a = evaluateSpend(history, now, MINOR_POLICY);

  assert.equal(a.triggered, true, 'should trigger');
  assert.equal(a.windowTotalMinor, 300_000, '₹3,000 total');
  assert.ok(
    a.triggers.includes('CUMULATIVE_THRESHOLD'),
    `expected cumulative trigger, got ${a.triggers.join(',')}`,
  );
  // The point of the feature: nothing here is individually large.
  assert.ok(
    a.largestMinor < MINOR_POLICY.singlePaymentMinor,
    'no single payment should have been large enough on its own',
  );
});

test('the same spend is unremarkable for an adult', () => {
  const history = [0, 5, 12, 20, 31, 44].map((m, i) => tx(500, m, i));
  const a = evaluateSpend(history, now, {
    ...MINOR_POLICY,
    cumulativeMinor: 5_000_000,
    singlePaymentMinor: 2_500_000,
    rapidCount: 99,
  });
  assert.equal(a.triggered, false, 'adult thresholds should stay quiet');
});

test('a parent is not messaged seven times for seven payments', () => {
  const history = [0, 5, 12, 20, 31, 44].map((m, i) => tx(500, m, i));
  const a = evaluateSpend(history, now, MINOR_POLICY);

  assert.equal(shouldNotifyGuardian(a, null, null, now, MINOR_POLICY), true, 'first one goes');
  assert.equal(
    shouldNotifyGuardian(a, now - 60_000, a.band, now, MINOR_POLICY),
    false,
    'a minute later, silence',
  );
});

test('but a worse situation breaks through the quiet period', () => {
  const history = [0, 5, 12, 20, 31, 44].map((m, i) => tx(500, m, i));
  const worse = evaluateSpend([...history, tx(9000, 1, 99)], now, MINOR_POLICY);
  assert.equal(
    shouldNotifyGuardian(worse, now - 60_000, 'MEDIUM', now, MINOR_POLICY),
    true,
    'escalation must not be silenced by a cooldown',
  );
});
