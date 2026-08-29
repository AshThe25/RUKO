#!/usr/bin/env node
/**
 * Run Ruko's three demo scenarios through the real pipeline and print the live
 * investigation trace, exactly as the phone UI receives it.
 *
 *   node scripts/demo-scenarios.ts
 *
 * Nothing is hardcoded. The classifier, behaviour engine, payee engine, agent,
 * risk engine and policy all run for real; only the device inputs are scripted.
 */

import { RukoAgent } from '../mobile/src/agent/rukoAgent.ts';
import { HeuristicClassifier } from '../mobile/src/risk/classifier/heuristicClassifier.ts';
import { INTERVENTION_COPY } from '../mobile/src/risk/policy.ts';
import {
  DemoCallProvider, DemoConversationProvider, DemoNotificationProvider,
  DemoPaymentProvider, InMemoryHistoryStore, demoHistory,
} from '../mobile/src/tools/demoProviders.ts';
import type { RukoProviders } from '../mobile/src/tools/providers.ts';

const NOW = Date.UTC(2026, 7, 29, 14, 30, 0);
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const RED = '\x1b[31m', YELLOW = '\x1b[33m', GREEN = '\x1b[32m';

const LEVEL_COLOUR: Record<string, string> = {
  LOW: GREEN, MEDIUM: YELLOW, HIGH: YELLOW, CRITICAL: RED,
};

function build() {
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
  return providers;
}

async function runScenario(
  title: string,
  setup: (p: RukoProviders) => void,
): Promise<void> {
  const providers = build();
  setup(providers);

  console.log(`\n${BOLD}${'━'.repeat(76)}${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}${'━'.repeat(76)}${RESET}\n`);

  const agent = new RukoAgent({ providers, sessionId: `demo-${Date.now()}` });
  const result = await agent.investigate('PAYMENT_SCREEN_DETECTED', (entry) => {
    const marker = entry.kind === 'TOOL_RESULT' ? '  ✓'
      : entry.kind === 'ERROR' ? '  ✗'
        : entry.kind === 'TOOL_START' ? '  ·' : '   ';
    if (entry.kind === 'TOOL_START') {
      console.log(`${DIM}${marker} ${entry.message}…${RESET}`);
    } else if (entry.kind === 'TOOL_RESULT' || entry.kind === 'ERROR') {
      console.log(`${marker} ${entry.message}`);
    } else if (entry.kind === 'RISK' || entry.kind === 'POLICY') {
      console.log(`\n   ${entry.message}`);
    } else {
      console.log(`${DIM}   ${entry.message}${RESET}`);
    }
  });

  const { risk } = result;
  const colour = LEVEL_COLOUR[risk.level] ?? '';
  console.log(`\n   ${colour}${BOLD}${risk.score} / 100   ${risk.level}${RESET}`);
  console.log(`   ${DIM}corroborated by: ${risk.corroboratingFamilies.join(', ') || 'nothing'}${RESET}`);

  const copy = INTERVENTION_COPY[risk.policyAction];
  if (copy) {
    console.log(`\n   ${BOLD}${copy.title.toUpperCase()}${RESET}`);
    console.log(`   ${copy.body.replace(/(.{1,68})(\s|$)/g, '$1\n   ').trim()}`);
    console.log(`\n   ${BOLD}WHY?${RESET}`);
    for (const reason of risk.reasons.slice(0, 5)) {
      console.log(`     • ${reason.label} ${DIM}(+${reason.points.toFixed(1)})${RESET}`);
    }
  }
  if (risk.degraded) {
    console.log(`\n   ${DIM}Ruko held back on:${RESET}`);
    for (const r of risk.degradedReasons) console.log(`     ${DIM}- ${r}${RESET}`);
  }
  if (risk.escalateToGuardian) {
    console.log(`\n   ${RED}→ Guardian alerted (Office Kit)${RESET}`);
  }
  console.log(`\n   ${DIM}${result.trace.length} trace entries · investigation took `
    + `${result.totalMs} ms · engine ${risk.engineVersion} · weights ${risk.weightsVersion} `
    + `· model ${risk.modelVersion} (${result.evidence.conversation.backend})${RESET}`);
}

const SCAM =
  'hello sir i am calling from your bank there has been suspicious activity on ' +
  'your account your account will be frozen you must transfer 48000 immediately ' +
  'to the safe account do not disconnect this call and do not tell anyone in ' +
  'your family about this';

await runScenario('SCENARIO 1 — bank impersonation, ₹48,000 to a new recipient', (p) => {
  (p.conversation as DemoConversationProvider).setTranscript(SCAM);
  (p.call as DemoCallProvider).startCall({ callerKnown: false, startedBeforePayment: true });
  (p.payment as DemoPaymentProvider).openPayment('Ravi Verify', 48_000_00, NOW);
  (p.notification as DemoNotificationProvider).setNotifications(0.61, ['ACCOUNT_FREEZE'], 2);
});

await runScenario('SCENARIO 2 — a friend asking for ₹500 for dinner', (p) => {
  (p.conversation as DemoConversationProvider)
    .setTranscript('hey can you send me 500 for dinner last night i will pay you back');
  (p.payment as DemoPaymentProvider).openPayment('Arjun', 500_00, NOW);
});

await runScenario('SCENARIO 3 — ₹50,000 rent to the landlord, paid every month', (p) => {
  (p.conversation as DemoConversationProvider)
    .setTranscript('i am sending the rent of 50000 to the landlord today like every month');
  (p.payment as DemoPaymentProvider).openPayment('Landlord', 50_000_00, NOW);
});

console.log(`\n${DIM}${'─'.repeat(76)}${RESET}`);
console.log('Scenarios 1 and 3 involve almost the same amount of money.');
console.log('Only the context around the payment separates them.\n');
