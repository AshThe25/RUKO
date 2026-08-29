/**
 * End-to-end demo scenarios, master spec §38-40.
 *
 * These run the ENTIRE pipeline with nothing stubbed except the device inputs:
 * a scripted transcript, a controlled payment screen and a seeded transaction
 * history. The classifier, behaviour engine, payee engine, agent, risk engine
 * and policy all execute for real.
 *
 * Nothing here asserts a hardcoded score. The demo has to actually work.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RukoAgent } from '../rukoAgent.ts';
import { HeuristicClassifier } from '../../risk/classifier/heuristicClassifier.ts';
import {
  DemoCallProvider, DemoConversationProvider, DemoNotificationProvider,
  DemoPaymentProvider, InMemoryHistoryStore, demoHistory,
} from '../../tools/demoProviders.ts';
import type { RukoProviders } from '../../tools/providers.ts';

const NOW = Date.UTC(2026, 7, 29, 14, 30, 0);

/** The scammer's script from the master spec, as ASR would transcribe it. */
const SCAM_TRANSCRIPT =
  'hello sir i am calling from your bank there has been suspicious activity on ' +
  'your account your account will be frozen you must transfer 48000 immediately ' +
  'to the safe account do not disconnect this call and do not tell anyone in ' +
  'your family about this';

function scenario() {
  const history = new InMemoryHistoryStore();
  history.seed(demoHistory(NOW), ['Landlord']);
  const providers: RukoProviders = {
    conversation: new DemoConversationProvider(new HeuristicClassifier()),
    payment: new DemoPaymentProvider(NOW),
    call: new DemoCallProvider(),
    notification: new DemoNotificationProvider(),
    history,
    now: () => NOW,
  };
  return {
    providers,
    conversation: providers.conversation as DemoConversationProvider,
    payment: providers.payment as DemoPaymentProvider,
    call: providers.call as DemoCallProvider,
    notification: providers.notification as DemoNotificationProvider,
  };
}

describe('§38 — the scam demo', () => {
  test('bank-impersonation call + 48,000 to a new payee reaches CRITICAL', async () => {
    const s = scenario();
    s.conversation.setTranscript(SCAM_TRANSCRIPT);
    s.call.startCall({ callerKnown: false, direction: 'INCOMING',
      durationMs: 380_000, startedBeforePayment: true });
    s.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    s.notification.setNotifications(0.61, ['ACCOUNT_FREEZE'], 2);

    const result = await new RukoAgent({ providers: s.providers, sessionId: 'demo-scam' })
      .investigate('PAYMENT_SCREEN_DETECTED');

    assert.equal(result.risk.level, 'CRITICAL',
      `expected CRITICAL, got ${result.risk.level} at ${result.risk.score}`);
    assert.equal(result.risk.policyAction, 'BLOCK_WARNING');
    assert.equal(result.risk.escalateToGuardian, true);
    assert.equal(result.state, 'GUARDIAN_ESCALATION');

    // The classifier had to find these itself from the transcript.
    const c = result.evidence.conversation;
    assert.ok(c.scores.authority > 0.5, `authority ${c.scores.authority}`);
    assert.ok(c.scores.coercion > 0.5, `coercion ${c.scores.coercion}`);
    assert.ok(c.scores.urgency > 0.5, `urgency ${c.scores.urgency}`);
    assert.ok(c.scores.financialInstruction > 0.5, `financial ${c.scores.financialInstruction}`);
    assert.ok(c.scores.secrecy > 0.5, `secrecy ${c.scores.secrecy}`);

    // And the context had to come from the seeded history, not from a constant.
    assert.equal(result.evidence.payee.known, false, 'Ravi Verify is a new payee');
    assert.ok((result.evidence.behaviour.amountRatio ?? 0) > 3,
      'the amount must be genuinely unusual against the seeded history');

    assert.ok(result.risk.corroboratingFamilies.length >= 2);
    assert.ok(result.risk.reasons.length >= 4);
    assert.equal(result.risk.reasons[0].code, 'COERCION');
  });
});

describe('§39 — the safe demo (false positives are the real failure mode)', () => {
  test('"send 500 for dinner" to a known friend stays silent', async () => {
    const s = scenario();
    s.conversation.setTranscript('hey can you send me 500 for dinner last night i will pay you back');
    s.payment.openPayment('Arjun', 500_00, NOW);

    const result = await new RukoAgent({ providers: s.providers, sessionId: 'demo-safe' })
      .investigate('PAYMENT_SCREEN_DETECTED');

    assert.equal(result.risk.level, 'LOW', `got ${result.risk.level} at ${result.risk.score}`);
    assert.equal(result.risk.policyAction, 'NONE');
    assert.equal(result.risk.escalateToGuardian, false);
    assert.equal(result.evidence.payee.known, true);
  });
});

describe('§40 — the large legitimate payment', () => {
  test('50,000 rent to the known landlord does not become an intervention', async () => {
    const s = scenario();
    s.conversation.setTranscript('i am sending the rent of 50000 to the landlord today like every month');
    s.payment.openPayment('Landlord', 50_000_00, NOW);

    const result = await new RukoAgent({ providers: s.providers, sessionId: 'demo-rent' })
      .investigate('PAYMENT_SCREEN_DETECTED');

    assert.notEqual(result.risk.level, 'CRITICAL');
    assert.notEqual(result.risk.policyAction, 'BLOCK_WARNING');
    assert.equal(result.risk.escalateToGuardian, false);
    assert.equal(result.evidence.payee.userTrusted, true);
    // The amount IS unusual. Context is what stops it becoming a warning.
    assert.ok((result.evidence.behaviour.amountRatio ?? 0) > 3,
      'the rent really is several times the usual payment');
  });

  test('the same 50,000 to a stranger, during a pressure call, is treated very differently', async () => {
    const s = scenario();
    s.conversation.setTranscript(SCAM_TRANSCRIPT);
    s.call.startCall({ callerKnown: false, startedBeforePayment: true });
    s.payment.openPayment('Verify Refund Cell', 50_000_00, NOW);

    const result = await new RukoAgent({ providers: s.providers }).investigate('PAYMENT_SCREEN_DETECTED');
    assert.equal(result.risk.level, 'CRITICAL');
  });
});

describe('offline and standalone operation', () => {
  test('the whole pipeline runs with no network available', async () => {
    // Nothing in the risk layer, the agent, the tools or the fallback classifier
    // imports fetch, XMLHttpRequest or any network module. Breaking them proves
    // it: if anything reached for the network, these tests would fail.
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = () => {
      throw new Error('network access attempted during offline test');
    };
    try {
      const s = scenario();
      s.conversation.setTranscript(SCAM_TRANSCRIPT);
      s.call.startCall({ callerKnown: false, startedBeforePayment: true });
      s.payment.openPayment('Ravi Verify', 48_000_00, NOW);

      const result = await new RukoAgent({ providers: s.providers }).investigate('PAYMENT_SCREEN_DETECTED');
      assert.equal(result.risk.level, 'CRITICAL');
      assert.equal(result.evidence.conversation.available, true);
    } finally {
      (globalThis as Record<string, unknown>).fetch = originalFetch;
    }
  });

  test('with the guardian unreachable, the phone still protects on its own', async () => {
    // The agent has no guardian dependency at all -- escalation is a flag on the
    // result that the app acts on. There is nothing here to disconnect, which is
    // the design: the guardian cannot be a single point of failure.
    const s = scenario();
    s.conversation.setTranscript(SCAM_TRANSCRIPT);
    s.call.startCall({ callerKnown: false, startedBeforePayment: true });
    s.payment.openPayment('Ravi Verify', 48_000_00, NOW);

    const result = await new RukoAgent({ providers: s.providers }).investigate('PAYMENT_SCREEN_DETECTED');
    assert.equal(result.risk.policyAction, 'BLOCK_WARNING',
      'the block is decided on the phone, not by the guardian');
    assert.equal(result.risk.escalateToGuardian, true, 'the guardian is notified, not consulted');
  });
});
