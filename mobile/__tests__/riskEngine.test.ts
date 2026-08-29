/**
 * Risk engine behaviour. These are the cases that decide whether Ruko is
 * trustworthy: it has to fire on the scam, and — just as importantly — it has
 * to stay quiet on the large payment that is completely normal.
 */
import type {
  BehaviourEvidence,
  CallEvidence,
  ConversationEvidence,
  NotificationEvidence,
  PayeeEvidence,
  PaymentEvidence,
  RiskEvidence,
} from '@contracts';
import {evaluate} from '@/services/stubs/stubRiskEngine';

const conversation = (
  scores: Partial<ConversationEvidence['scores']>,
  overrides: Partial<ConversationEvidence> = {},
): ConversationEvidence => ({
  available: true,
  source: 'ON_DEVICE_HEURISTIC',
  scores: {
    authority: 0,
    coercion: 0,
    urgency: 0,
    financialInstruction: 0,
    secrecy: 0,
    credentialRequest: 0,
    ...scores,
  },
  reliability: 0.85,
  windowMs: 12000,
  transcriptChars: 240,
  modelVersion: 'test-model',
  backend: 'HEURISTIC',
  timestamp: 0,
  ...overrides,
});

const payment = (amountMinor: number | null, active = true): PaymentEvidence => ({
  available: true,
  source: 'DEMO',
  active,
  amountMinor,
  currency: 'INR',
  payeeDisplayName: 'Test Payee',
  payeeHash: 'hash',
  timestamp: 0,
});

const payee = (overrides: Partial<PayeeEvidence> = {}): PayeeEvidence => ({
  available: true,
  source: 'LOCAL_STORE',
  known: true,
  previousTransactions: 12,
  averageAmountMinor: 60000,
  maxAmountMinor: 120000,
  firstSeen: 0,
  lastSeen: 0,
  ageDays: 300,
  userTrusted: false,
  ...overrides,
});

const behaviour = (overrides: Partial<BehaviourEvidence> = {}): BehaviourEvidence => ({
  available: true,
  source: 'LOCAL_STORE',
  amountRatio: 1,
  amountAnomaly: 0,
  medianAmountMinor: 80000,
  meanAmountMinor: 90000,
  p95AmountMinor: 210000,
  frequencyAnomaly: 0,
  timeAnomaly: 0,
  sampleSize: 12,
  profileMature: true,
  ...overrides,
});

const call = (overrides: Partial<CallEvidence> = {}): CallEvidence => ({
  available: true,
  source: 'ANDROID_API',
  active: false,
  callerKnown: null,
  direction: 'UNKNOWN',
  durationMs: null,
  startedBeforePayment: null,
  ...overrides,
});

const notification = (suspicion: number): NotificationEvidence => ({
  available: true,
  source: 'ANDROID_API',
  suspicion,
  matchedCategories: ['ACCOUNT_FREEZE'],
  count: 2,
  windowMs: 86_400_000,
});

const evidence = (parts: Partial<RiskEvidence>): RiskEvidence => ({
  sessionId: 'test',
  timestamp: 0,
  conversation: conversation({}),
  payment: payment(50000),
  payee: payee(),
  behaviour: behaviour(),
  call: call(),
  ...parts,
});

describe('risk engine', () => {
  it('is deterministic for the same evidence', () => {
    const input = evidence({});
    const a = evaluate(input);
    const b = evaluate(input);
    expect(a.score).toBe(b.score);
    expect(a.reasons).toEqual(b.reasons);
  });

  it('stays quiet on a safe conversation and a normal payment', () => {
    const result = evaluate(
      evidence({
        conversation: conversation({financialInstruction: 0.2}),
        payment: payment(50000),
      }),
    );
    expect(result.level).toBe('LOW');
    expect(result.policyAction).toBe('NONE');
  });

  it('reaches CRITICAL on the bank-impersonation pattern', () => {
    const result = evaluate(
      evidence({
        conversation: conversation({
          authority: 0.94,
          coercion: 0.91,
          urgency: 0.96,
          financialInstruction: 0.97,
          secrecy: 0.72,
        }),
        payment: payment(4_800_000),
        payee: payee({known: false, previousTransactions: 0, averageAmountMinor: null}),
        behaviour: behaviour({amountRatio: 22, amountAnomaly: 1}),
        call: call({active: true, callerKnown: false, direction: 'INCOMING'}),
        notification: notification(0.61),
      }),
    );
    expect(result.level).toBe('CRITICAL');
    expect(result.policyAction).toBe('BLOCK_WARNING');
    expect(result.escalateToGuardian).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(3);
  });

  it('does not flag a large payment to a trusted recipient', () => {
    // ₹50,000 rent, known landlord, no call, no conversation pressure.
    const result = evaluate(
      evidence({
        conversation: conversation({}),
        payment: payment(5_000_000),
        payee: payee({known: true, userTrusted: true, previousTransactions: 9}),
        behaviour: behaviour({amountRatio: 1, amountAnomaly: 0}),
        call: call({active: false}),
      }),
    );
    expect(result.level).toBe('LOW');
    expect(result.policyAction).toBe('NONE');
  });

  it('never reaches CRITICAL on one evidence family alone', () => {
    // Maximal conversation signals, but nothing else corroborates.
    const result = evaluate(
      evidence({
        conversation: conversation({
          authority: 1,
          coercion: 1,
          urgency: 1,
          financialInstruction: 1,
          secrecy: 1,
        }),
        payee: payee({known: true, previousTransactions: 30}),
        behaviour: behaviour({amountAnomaly: 0}),
        call: call({active: false}),
      }),
    );
    expect(result.corroboratingFamilies).toEqual(['CONVERSATION']);
    // The conversation weights sum to 75, so talk alone cannot reach CRITICAL
    // even at maximum confidence. Stopping a payment needs corroboration from
    // the recipient, the amount or the call.
    expect(result.score).toBeLessThan(80);
    expect(result.level).not.toBe('CRITICAL');
  });

  it('reaches CRITICAL only once a second family corroborates', () => {
    const talk = conversation({
      authority: 1,
      coercion: 1,
      urgency: 1,
      financialInstruction: 1,
      secrecy: 1,
    });
    const alone = evaluate(
      evidence({
        conversation: talk,
        payee: payee({known: true, previousTransactions: 30}),
        behaviour: behaviour({amountAnomaly: 0}),
        call: call({active: false}),
      }),
    );
    const corroborated = evaluate(
      evidence({
        conversation: talk,
        payee: payee({known: false, previousTransactions: 0, averageAmountMinor: null}),
        behaviour: behaviour({amountRatio: 20, amountAnomaly: 1}),
        call: call({active: true, callerKnown: false, direction: 'INCOMING'}),
      }),
    );
    expect(alone.level).toBe('HIGH');
    expect(corroborated.level).toBe('CRITICAL');
    expect(corroborated.corroboratingFamilies.length).toBeGreaterThanOrEqual(2);
  });

  it('down-weights an unreliable transcript instead of guessing', () => {
    const scores = {authority: 0.9, coercion: 0.9, urgency: 0.9, financialInstruction: 0.9};
    const confident = evaluate(
      evidence({conversation: conversation(scores, {reliability: 0.9})}),
    );
    const unsure = evaluate(
      evidence({conversation: conversation(scores, {reliability: 0.2})}),
    );
    expect(unsure.score).toBeLessThan(confident.score);
    expect(unsure.degraded).toBe(true);
  });

  it('treats missing evidence as unknown, not as zero risk', () => {
    const result = evaluate(
      evidence({
        conversation: conversation({}, {available: false, unavailableReason: 'Microphone not granted.'}),
        payee: {...payee(), available: false},
        behaviour: {...behaviour(), available: false},
        call: {...call(), available: false},
      }),
    );
    expect(result.degraded).toBe(true);
    expect(result.degradedReasons).toContain('Microphone not granted.');
    // Unavailable evidence contributes nothing rather than inventing a signal.
    expect(result.contributions.every(c => c.points === 0)).toBe(true);
  });

  it('will not raise risk on a suspicious notification alone', () => {
    const result = evaluate(
      evidence({
        conversation: conversation({}),
        notification: notification(1),
      }),
    );
    const notificationPoints = result.contributions.find(
      c => c.code === 'SUSPICIOUS_NOTIFICATION',
    )!.points;
    expect(notificationPoints).toBe(0);
  });

  it('ignores an immature behaviour profile', () => {
    const result = evaluate(
      evidence({
        behaviour: behaviour({sampleSize: 2, profileMature: false, amountAnomaly: 1, amountRatio: 40}),
      }),
    );
    const amountPoints = result.contributions.find(c => c.code === 'AMOUNT_ANOMALY')!.points;
    expect(amountPoints).toBe(0);
    expect(result.degradedReasons.join(' ')).toMatch(/not enough payment history/i);
  });

  it('records the versions needed to reproduce a decision', () => {
    const result = evaluate(evidence({}));
    expect(result.engineVersion).toBeTruthy();
    expect(result.weightsVersion).toBeTruthy();
    expect(result.policyVersion).toBeTruthy();
    expect(result.contributions.length).toBeGreaterThan(0);
  });
});
