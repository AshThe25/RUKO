/**
 * CROSS-WORKSTREAM INTEGRATION TEST.
 *
 * This is the test that answers "will it actually work once we merge?".
 *
 * It implements Aishwarya's published provider contract (contracts-v1.1:
 * `ContextProvider<T>`, `ConversationProvider`, `BehaviourStore`) exactly as
 * written, then drives MY investigation agent and MY deterministic risk engine
 * through it via the adapter in `fromRukoServices.ts`.
 *
 * It does not import her stub implementations directly -- those resolve through
 * the `@contracts` path alias, which Metro and Babel handle but plain Node does
 * not, so the two test runners cannot yet load each other's modules. Conforming
 * to the published contract is what actually matters here, and the harness does
 * that; the remaining risk is only that her stubs deviate from her own contract,
 * which her own 51 tests cover.
 *
 * If the two halves of the app disagree about anything — provider shapes,
 * paise vs rupees, availability flags, evidence structure — this goes red.
 * Nothing here is stubbed on my side: the real agent, the real tools, the real
 * behaviour and payee engines and the real risk engine all run.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { providersFromRukoServices } from '../fromRukoServices.ts';
import { RukoAgent } from '../../agent/rukoAgent.ts';
import { evaluateRisk, getRiskEngineConfig } from '../../risk/riskEngine.ts';
import { hashPayee } from '../../risk/hash.ts';
import { demoHistory, DEMO_SALT } from '../demoProviders.ts';
import { HeuristicClassifier } from '../../risk/classifier/heuristicClassifier.ts';
import type {
  CallEvidence, ConversationEvidence, NotificationEvidence,
  PaymentEvidence, RukoServices,
} from '../../contracts/index.ts';

const NOW = Date.UTC(2026, 7, 29, 14, 30, 0);

/**
 * A `RukoServices` implemented strictly against contracts-v1.1 —
 * `ContextProvider<T>` with `source` / `read()` / `subscribe()`, and a
 * `BehaviourStore` with her exact method set.
 *
 * NOTE ON WHY THIS IS HAND-BUILT rather than importing her deviceStubs
 * directly: her modules import through the `@contracts` path alias, which is
 * resolved by Metro and Babel but not by plain Node, so the two test runners
 * cannot yet load each other's code. That is an integration note, not a defect
 * — the alias works fine in the app. What matters for correctness is that this
 * harness implements HER published contract exactly, so if my adapter or my
 * engines disagree with that contract, these tests fail.
 */
class Bus {
  call = idleCall();
  payment = idlePayment();
  notification = noNotifications();
  conversation = emptyConversation();
  transcript = '';

  startCall(opts: { callerKnown: boolean | null; startedBeforePayment?: boolean }): void {
    this.call = {
      available: true, source: 'DEMO', active: true,
      callerKnown: opts.callerKnown, direction: 'INCOMING', durationMs: 300_000,
      startedBeforePayment: opts.startedBeforePayment ?? true,
    };
  }

  openPayment(p: { payeeDisplayName: string; amountMinor: number; payeeHash: string }): void {
    this.payment = {
      available: true, source: 'DEMO', active: true,
      amountMinor: p.amountMinor, currency: 'INR',
      payeeDisplayName: p.payeeDisplayName, payeeHash: p.payeeHash, timestamp: NOW,
    };
  }

  setNotifications(suspicion: number, categories: string[], count: number): void {
    this.notification = {
      available: true, source: 'DEMO', suspicion,
      matchedCategories: categories, count, windowMs: 600_000,
    };
  }

  /** Classification happens in the provider on her side, as the contract says. */
  async setTranscript(text: string): Promise<void> {
    this.transcript = text;
    this.conversation = await sharedClassifier.classify(text);
  }
}

const sharedClassifier = new HeuristicClassifier();

const idleCall = (): CallEvidence => ({
  available: true, source: 'DEMO', active: false, callerKnown: null,
  direction: 'UNKNOWN', durationMs: null, startedBeforePayment: null,
});
const idlePayment = (): PaymentEvidence => ({
  available: true, source: 'DEMO', active: false, amountMinor: null,
  currency: 'INR', payeeDisplayName: null, payeeHash: null, timestamp: NOW,
});
const noNotifications = (): NotificationEvidence => ({
  available: true, source: 'DEMO', suspicion: 0,
  matchedCategories: [], count: 0, windowMs: 600_000,
});
const emptyConversation = (): ConversationEvidence => ({
  available: false, source: 'ON_DEVICE_HEURISTIC',
  unavailableReason: 'no speech captured',
  scores: { authority: 0, coercion: 0, urgency: 0,
    financialInstruction: 0, secrecy: 0, credentialRequest: 0 },
  reliability: 0, windowMs: 0, transcriptChars: 0,
  modelVersion: 'ruko-heuristic-v1', backend: 'HEURISTIC', timestamp: NOW,
});

/** Her ContextProvider<T>, implemented exactly. */
function contextProvider<T>(read: () => T) {
  return {
    source: 'DEMO' as const,
    async read(): Promise<T> { return read(); },
    subscribe(listener: (v: T) => void) { listener(read()); return () => {}; },
  };
}

async function buildServices(): Promise<{ services: RukoServices; bus: Bus }> {
  const bus = new Bus();
  await sharedClassifier.loadModel();
  const transactions = demoHistory(NOW);

  /** Her BehaviourStore contract, implemented exactly. */
  const behaviour = {
    source: 'LOCAL_STORE' as const,
    async getBehaviour() { throw new Error('adapter must not call getBehaviour'); },
    async getPayee() { throw new Error('adapter must not call getPayee'); },
    async listTransactions() { return transactions; },
    async recordTransaction() {},
    async seed() {},
  };

  const services = {
    call: contextProvider(() => bus.call),
    payment: contextProvider(() => bus.payment),
    notification: contextProvider(() => bus.notification),
    conversation: {
      source: 'ON_DEVICE_MODEL' as const,
      async start() {}, async stop() {}, isRunning: () => true,
      async read() { return bus.conversation; },
      subscribe(l: (v: ConversationEvidence) => void) { l(bus.conversation); return () => {}; },
    },
    behaviour,
    // --- the two seams createServices.ts is waiting to have swapped ---
    risk: { evaluate: evaluateRisk, getConfig: getRiskEngineConfig },
    agent: null as never,
    guardian: null as never,
    diagnostics: null as never,
  } as unknown as RukoServices;

  return { services, bus };
}

function makeAgent(services: RukoServices, sessionId: string): RukoAgent {
  return new RukoAgent({
    providers: providersFromRukoServices(services, () => NOW),
    sessionId,
  });
}

describe('cross-workstream integration: contracts-v1.1 providers -> my agent -> my engine', () => {
  test('my risk engine satisfies the RiskEngine contract her app injects', async () => {
    const { services } = await buildServices();
    assert.equal(typeof services.risk.evaluate, 'function');
    assert.equal(typeof services.risk.getConfig, 'function');
    const cfg = services.risk.getConfig();
    assert.equal(cfg.weightsVersion, 'ruko-weights-v1');
    assert.ok(cfg.weights.COERCION > 0);
  });

  test('the adapter maps every provider without losing availability', async () => {
    const { services } = await buildServices();
    const providers = providersFromRukoServices(services, () => NOW);

    const payment = await providers.payment.getPaymentContext();
    const call = await providers.call.getCallContext();
    const notification = await providers.notification!.getNotificationContext();
    const transactions = await providers.history.getTransactions();

    for (const [name, e] of [['payment', payment], ['call', call],
      ['notification', notification]] as const) {
      assert.ok(typeof e.available === 'boolean', `${name} lost its availability flag`);
      assert.ok(typeof e.source === 'string', `${name} lost its source`);
    }
    assert.ok(transactions.length > 0, 'her behaviour store fed my engines no history');
    assert.ok(transactions.every((t) => Number.isInteger(t.amountMinor)),
      'amounts must be integer paise across the seam');
  });

  test('SCAM: her provider contract + my engine still reach CRITICAL end to end', async () => {
    const { services, bus } = await buildServices();
    bus.startCall({ callerKnown: false, startedBeforePayment: true });
    bus.openPayment({
      payeeDisplayName: 'Ravi Verify',
      amountMinor: 48_000_00,
      payeeHash: hashPayee('Ravi Verify', DEMO_SALT),
    });
    await bus.setTranscript(
      'hello sir i am calling from your bank your account will be frozen you must ' +
      'transfer 48000 immediately to the safe account do not disconnect this call ' +
      'and do not tell anyone in your family about this',
    );

    const result = await makeAgent(services, 'integration-scam').investigate('PAYMENT_SCREEN_DETECTED');

    assert.equal(result.risk.level, 'CRITICAL',
      `expected CRITICAL, got ${result.risk.level} at ${result.risk.score}`);
    assert.equal(result.risk.policyAction, 'BLOCK_WARNING');
    assert.equal(result.risk.escalateToGuardian, true);
    assert.equal(result.evidence.payee.known, false, 'payee lookup crossed the seam');
    assert.ok((result.evidence.behaviour.amountRatio ?? 0) > 3,
      'her seeded history reached my behaviour engine');
  });

  test('SAFE: a known recipient and a normal amount stay silent end to end', async () => {
    const { services, bus } = await buildServices();
    bus.openPayment({
      payeeDisplayName: 'Arjun',
      amountMinor: 500_00,
      payeeHash: hashPayee('Arjun', DEMO_SALT),
    });
    await bus.setTranscript('hey can you send me 500 for dinner last night i will pay you back');

    const result = await makeAgent(services, 'integration-safe').investigate('PAYMENT_SCREEN_DETECTED');

    assert.equal(result.risk.level, 'LOW', `got ${result.risk.level} at ${result.risk.score}`);
    assert.equal(result.risk.policyAction, 'NONE');
    assert.equal(result.evidence.payee.known, true,
      'payee history must survive the adapter — this is what stops false positives');
  });

  test('LARGE LEGITIMATE: rent to an established landlord is not an intervention', async () => {
    const { services, bus } = await buildServices();
    bus.openPayment({
      payeeDisplayName: 'Landlord',
      amountMinor: 50_000_00,
      payeeHash: hashPayee('Landlord', DEMO_SALT),
    });
    await bus.setTranscript('i am sending the rent of 50000 to the landlord today like every month');

    const result = await makeAgent(services, 'integration-rent').investigate('PAYMENT_SCREEN_DETECTED');

    assert.notEqual(result.risk.level, 'CRITICAL');
    assert.notEqual(result.risk.policyAction, 'BLOCK_WARNING');
    // The documented consequence of BehaviourStore having no getTrustedPayees():
    // the damper must still engage via prior-transaction count instead.
    const anomaly = result.risk.contributions.find((c) => c.code === 'AMOUNT_ANOMALY');
    assert.ok(anomaly!.gate < 1,
      'the established-payee damper must engage from transaction count alone');
    assert.ok(result.risk.score < 30, `expected LOW, got ${result.risk.score}`);
  });

  test('the classifier is not run twice when the provider already classified', async () => {
    const { services, bus } = await buildServices();
    bus.openPayment({
      payeeDisplayName: 'Ravi Verify',
      amountMinor: 48_000_00,
      payeeHash: hashPayee('Ravi Verify', DEMO_SALT),
    });
    await bus.setTranscript('your account will be frozen transfer 48000 immediately');

    let reads = 0;
    const original = services.conversation.read.bind(services.conversation);
    services.conversation.read = async () => { reads++; return original(); };

    await makeAgent(services, 'integration-once').investigate('PAYMENT_SCREEN_DETECTED');
    assert.equal(reads, 1, 'the only expensive call in the pipeline ran more than once');
  });

  test('a provider that throws degrades the run instead of breaking the app', async () => {
    const { services, bus } = await buildServices();
    bus.openPayment({
      payeeDisplayName: 'Ravi Verify',
      amountMinor: 48_000_00,
      payeeHash: hashPayee('Ravi Verify', DEMO_SALT),
    });
    services.call.read = async () => { throw new Error('phone state permission revoked'); };

    const result = await makeAgent(services, 'integration-fail').investigate('PAYMENT_SCREEN_DETECTED');
    assert.deepEqual(result.failedTools, ['callContextTool']);
    assert.equal(result.evidence.call.available, false);
    assert.ok(result.risk.score >= 0);
    assert.equal(result.risk.degraded, true);
  });
});
