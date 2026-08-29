/**
 * Seeds the stub device layer for a scenario: local payment history, the
 * recipient's record, call state and notifications. Shared by the app and the
 * tests so both exercise exactly the same setup.
 */
import type {StubBehaviourStore, StubDeviceBus} from './deviceStubs';
import {SCENARIOS, type Scenario, type ScenarioId} from './scenarios';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function prepareScenario(
  bus: StubDeviceBus,
  behaviour: StubBehaviourStore,
  id: ScenarioId,
): Promise<Scenario> {
  const scenario = SCENARIOS[id];

  await behaviour.seedAmounts(scenario.history);
  behaviour.setPayee(scenario.payment.payeeHash, {
    available: true,
    source: 'LOCAL_STORE',
    known: scenario.payee.known,
    previousTransactions: scenario.payee.previousTransactions,
    averageAmountMinor: scenario.payee.averageAmountMinor,
    maxAmountMinor: scenario.payee.averageAmountMinor,
    firstSeen: scenario.payee.ageDays ? Date.now() - scenario.payee.ageDays * DAY_MS : null,
    lastSeen: scenario.payee.known ? Date.now() - 3 * DAY_MS : null,
    ageDays: scenario.payee.ageDays,
    userTrusted: scenario.payee.userTrusted,
  });

  bus.loadScenario(id);
  return scenario;
}

/**
 * Runs a scenario's whole transcript through the classifier at once, without
 * waiting on the scripted timings. Used by tests and by nothing else — the app
 * always plays the conversation in real time.
 */
export async function playTranscriptImmediately(
  bus: StubDeviceBus,
  scenario: Scenario,
): Promise<void> {
  if (scenario.lines.length === 0) {
    return;
  }
  const transcript = scenario.lines.map(l => l.text);
  bus.transcript.emit(transcript);
  const evidence = await bus.getClassifier().classify(transcript.join(' '));
  bus.conversation.emit(evidence);
}
