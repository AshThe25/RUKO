/**
 * End-to-end through the real pipeline: scripted speech -> classifier ->
 * investigation agent -> risk engine -> policy.
 *
 * Nothing here asserts a hardcoded score. The assertions are about *outcomes*,
 * which is what the product promises: fire on the scam, stay silent on the
 * everyday payment, and stay silent on the large payment that is normal for
 * this user.
 */
import {createServices} from '@/services/createServices';
import {playTranscriptImmediately, prepareScenario} from '@/services/stubs/prepareScenario';
import type {ScenarioId} from '@/services/stubs/scenarios';

async function runScenario(id: ScenarioId) {
  const runtime = createServices({forceStubs: true});
  await runtime.demo.bus.init();
  const scenario = await prepareScenario(runtime.demo.bus, runtime.demo.behaviour, id);
  await playTranscriptImmediately(runtime.demo.bus, scenario);
  runtime.demo.bus.openPayment(
    scenario.payment.amountMinor,
    scenario.payment.payeeDisplayName,
    scenario.payment.payeeHash,
  );
  const result = await runtime.services.agent.investigate(scenario.trigger);
  return {runtime, scenario, result};
}

describe('protection pipeline', () => {
  it('intervenes on the bank-impersonation call', async () => {
    const {result} = await runScenario('bank-impersonation');

    // The promise is that Ruko interrupts this call, which is what both
    // interrupting actions do -- `useProtectionController` shows the overlay on
    // STRONG_WARNING and BLOCK_WARNING alike.
    //
    // This deliberately does not assert CRITICAL. These tests run the
    // deterministic lexical classifier (the neural model needs a device), and
    // measured against it this scenario scores 75 -- every one of the ten
    // reasons fires across four families, and it still lands below the
    // CRITICAL threshold of 80. So the fallback classifier interrupts this
    // scam but never escalates it to a guardian, since `decidePolicy` gates
    // escalation on CRITICAL. Whether the neural classifier closes that gap is
    // untested here and is not claimed; see the note in docs/HANDOFF.md.
    //
    // Pinning CRITICAL here would only be met by tuning the weights until the
    // demo landed, which is exactly what the engine's own comments forbid.
    expect(['STRONG_WARNING', 'BLOCK_WARNING']).toContain(result.risk.policyAction);
    expect(['HIGH', 'CRITICAL']).toContain(result.risk.level);

    // The score has to be attributable, not just high.
    const codes = result.risk.reasons.map(r => r.code);
    expect(codes).toEqual(expect.arrayContaining(['COERCION', 'AUTHORITY_IMPERSONATION', 'NEW_PAYEE']));
    expect(result.risk.corroboratingFamilies.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The guard that the reasoning above stays true: escalation is reserved for
   * CRITICAL, so if the fallback ever does reach it, that is a deliberate
   * change and this test should be revisited rather than quietly passing.
   */
  it('escalates to a guardian only at CRITICAL', async () => {
    const {result} = await runScenario('bank-impersonation');

    expect(result.risk.escalateToGuardian).toBe(result.risk.level === 'CRITICAL');
  });

  it('stays silent when a friend asks for dinner money', async () => {
    const {result} = await runScenario('friend-dinner');

    expect(result.risk.level).toBe('LOW');
    expect(result.risk.policyAction).toBe('NONE');
  });

  it('does not flag rent to a known landlord', async () => {
    const {result} = await runScenario('landlord-rent');

    expect(result.risk.level).toBe('LOW');
    expect(result.risk.policyAction).toBe('NONE');
    // ₹50,000 is 100x a typical everyday payment for this user, and it still
    // must not trigger — the recipient and the history are what make it normal.
    expect(result.evidence.payment.amountMinor).toBe(5_000_000);
  });

  it('produces a trace covering every tool', async () => {
    const {result} = await runScenario('bank-impersonation');
    const tools = new Set(result.trace.filter(t => t.tool).map(t => t.tool));
    expect(tools).toEqual(
      new Set([
        'paymentTool',
        'callContextTool',
        'payeeTool',
        'behaviourTool',
        'notificationTool',
        'conversationTool',
      ]),
    );
    expect(result.trace[result.trace.length - 1]!.kind).toBe('POLICY');
    expect(result.failedTools).toEqual([]);
  });

  it('scores the payment even with no conversation at all', async () => {
    const runtime = createServices({forceStubs: true});
    await runtime.demo.bus.init();
    const scenario = await prepareScenario(runtime.demo.bus, runtime.demo.behaviour, 'bank-impersonation');
    // Deliberately skip the transcript: microphone denied, or nothing heard.
    runtime.demo.bus.openPayment(
      scenario.payment.amountMinor,
      scenario.payment.payeeDisplayName,
      scenario.payment.payeeHash,
    );
    const result = await runtime.services.agent.investigate('PAYMENT_SCREEN_DETECTED');

    expect(result.risk.degraded).toBe(true);
    expect(result.risk.level).not.toBe('CRITICAL');
    // New payee + 20x amount + unknown caller is still worth saying something.
    expect(result.risk.score).toBeGreaterThan(0);
  });

  it('falls back to the phone when the guardian is not connected', async () => {
    const {runtime, result} = await runScenario('bank-impersonation');
    const decision = await runtime.services.guardian.sendAlert({
      sessionId: result.sessionId,
      deviceLabel: 'test',
      timestamp: Date.now(),
      score: result.risk.score,
      level: result.risk.level,
      amountMinor: result.evidence.payment.amountMinor,
      currency: 'INR',
      payeeDisplayName: result.evidence.payment.payeeDisplayName,
      reasons: result.risk.reasons,
      expiresInSec: 45,
    });
    expect(decision).toBeNull();
  });

  it('lets a connected guardian keep a payment blocked', async () => {
    const {runtime, result} = await runScenario('bank-impersonation');
    runtime.demo.guardian.pair('Test guardian');

    const pending = runtime.services.guardian.sendAlert({
      sessionId: result.sessionId,
      deviceLabel: 'test',
      timestamp: Date.now(),
      score: result.risk.score,
      level: result.risk.level,
      amountMinor: result.evidence.payment.amountMinor,
      currency: 'INR',
      payeeDisplayName: result.evidence.payment.payeeDisplayName,
      reasons: result.risk.reasons,
      expiresInSec: 45,
    });

    runtime.demo.guardian.respond(result.sessionId, 'KEEP_BLOCKED');
    await expect(pending).resolves.toMatchObject({decision: 'KEEP_BLOCKED'});
  });

  it('changes its verdict when the words change', async () => {
    // The demo is not a recording. Softening the script has to soften the score.
    const runtime = createServices({forceStubs: true});
    await runtime.demo.bus.init();
    const scenario = await prepareScenario(runtime.demo.bus, runtime.demo.behaviour, 'bank-impersonation');
    await playTranscriptImmediately(runtime.demo.bus, {
      ...scenario,
      lines: [{atMs: 0, speaker: 'CALLER', text: 'Hi, it is Ravi. Sending you the invoice now.'}],
    });
    runtime.demo.bus.openPayment(
      scenario.payment.amountMinor,
      scenario.payment.payeeDisplayName,
      scenario.payment.payeeHash,
    );
    const result = await runtime.services.agent.investigate('PAYMENT_SCREEN_DETECTED');
    expect(result.risk.level).not.toBe('CRITICAL');
  });
});
