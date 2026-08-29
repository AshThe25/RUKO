import {StubBehaviourStore, normaliseAmountRatio, percentile} from '@/services/stubs/deviceStubs';

describe('amount anomaly curve', () => {
  it('treats anything at or below the usual ceiling as unremarkable', () => {
    expect(normaliseAmountRatio(null)).toBe(0);
    expect(normaliseAmountRatio(0.5)).toBe(0);
    expect(normaliseAmountRatio(1)).toBe(0);
  });

  it('rises on a log scale and saturates at 8x', () => {
    expect(normaliseAmountRatio(2)).toBeCloseTo(1 / 3, 2);
    expect(normaliseAmountRatio(4)).toBeCloseTo(2 / 3, 2);
    expect(normaliseAmountRatio(8)).toBe(1);
    expect(normaliseAmountRatio(80)).toBe(1);
  });
});

describe('percentile', () => {
  it('picks the expected element', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('behaviour store', () => {
  it('refuses to judge an amount on a cold-start profile', async () => {
    const store = new StubBehaviourStore();
    await store.seedAmounts([500, 700]);
    const behaviour = await store.getBehaviour(4_800_000);
    expect(behaviour.profileMature).toBe(false);
    expect(behaviour.sampleSize).toBe(2);
  });

  it('computes real statistics once there is history', async () => {
    const store = new StubBehaviourStore();
    await store.seedAmounts([300, 450, 800, 1200, 2100, 650, 900]);
    const behaviour = await store.getBehaviour(4_800_000);
    expect(behaviour.available).toBe(true);
    expect(behaviour.profileMature).toBe(true);
    expect(behaviour.medianAmountMinor).toBeGreaterThan(0);
    expect(behaviour.amountRatio!).toBeGreaterThan(10);
    expect(behaviour.amountAnomaly).toBe(1);
  });

  it('reports an unknown recipient as unknown, not as missing', async () => {
    const store = new StubBehaviourStore();
    await store.seedAmounts([300, 450, 800, 1200, 2100]);
    const payee = await store.getPayee('never_seen');
    expect(payee.available).toBe(true);
    expect(payee.known).toBe(false);
    expect(payee.previousTransactions).toBe(0);
  });

  it('marks the payee unavailable when the payment screen exposed nothing', async () => {
    const store = new StubBehaviourStore();
    const payee = await store.getPayee(null);
    expect(payee.available).toBe(false);
    expect(payee.unavailableReason).toBeTruthy();
  });
});
