/**
 * The six investigation tools.
 *
 * A tool gathers one kind of evidence and does nothing else. It does not score,
 * does not decide, does not mutate app state, and never throws — a tool that
 * fails returns `ok: false` and the investigation carries on with that evidence
 * marked unavailable. Losing one signal must never lose the whole run.
 */

import type {
  CallEvidence, ConversationEvidence, InvestigationContext, InvestigationTool,
  NotificationEvidence, PaymentEvidence, ToolResult,
} from '../contracts/index.ts';
import type { BehaviourEvidence, PayeeEvidence } from '../contracts/index.ts';
import { buildProfile, evaluateBehaviour } from '../risk/behaviourEngine.ts';
import { buildPayeeIndex, evaluatePayee } from '../risk/payeeEngine.ts';
import type { RukoProviders } from './providers.ts';

export type { RukoProviders } from './providers.ts';
export type * from './providers.ts';

/** Wrap a gather step so a thrown error becomes unavailable evidence, not a crash. */
async function run<T>(
  tool: ToolResult<T>['tool'],
  source: ToolResult<T>['source'],
  fn: () => Promise<T>,
  now: () => number,
): Promise<ToolResult<T>> {
  const startedAt = now();
  try {
    const data = await fn();
    return { tool, ok: true, data, source, durationMs: now() - startedAt, timestamp: now() };
  } catch (err) {
    return {
      tool, ok: false, data: null,
      error: err instanceof Error ? err.message : String(err),
      source, durationMs: now() - startedAt, timestamp: now(),
    };
  }
}

export function createTools(providers: RukoProviders): InvestigationTool[] {
  const now = providers.now ?? (() => Date.now());

  const paymentTool: InvestigationTool<PaymentEvidence> = {
    name: 'paymentTool',
    description: 'Is a payment being made right now, to whom, and for how much?',
    cost: 'LOW',
    execute: (ctx) => run('paymentTool', 'ACCESSIBILITY',
      () => providers.payment.getPaymentContext(), now),
  };

  const callContextTool: InvestigationTool<CallEvidence> = {
    name: 'callContextTool',
    description: 'Is the user on a call, and is the other party in their contacts?',
    cost: 'LOW',
    execute: () => run('callContextTool', 'ANDROID_API',
      () => providers.call.getCallContext(), now),
  };

  const payeeTool: InvestigationTool<PayeeEvidence> = {
    name: 'payeeTool',
    description: 'Has this user paid this recipient before?',
    cost: 'LOW',
    execute: (ctx: InvestigationContext) => run('payeeTool', 'LOCAL_STORE', async () => {
      const [history, trusted] = await Promise.all([
        providers.history.getTransactions(),
        providers.history.getTrustedPayees(),
      ]);
      const index = buildPayeeIndex(history, trusted);
      return evaluatePayee(index, ctx.collected.payment?.payeeHash ?? null, now());
    }, now),
  };

  const behaviourTool: InvestigationTool<BehaviourEvidence> = {
    name: 'behaviourTool',
    description: 'How far outside this user\'s normal pattern is this payment?',
    cost: 'MEDIUM',
    execute: (ctx: InvestigationContext) => run('behaviourTool', 'LOCAL_STORE', async () => {
      const history = await providers.history.getTransactions();
      const profile = buildProfile(history, now());
      return evaluateBehaviour(
        profile,
        ctx.collected.payment?.amountMinor ?? null,
        now(),
        history.map((t) => t.timestamp),
      );
    }, now),
  };

  // The only expensive tool. The agent runs it deliberately, never on a timer.
  const conversationTool: InvestigationTool<ConversationEvidence> = {
    name: 'conversationTool',
    description: 'What manipulation tactics are present in what was just said?',
    cost: 'HIGH',
    execute: () => run('conversationTool', 'ON_DEVICE_MODEL', async () => {
      const window = await providers.conversation.getRecentTranscript();
      if (!window || !window.text.trim()) {
        const unavailable: ConversationEvidence = {
          available: false,
          source: 'ON_DEVICE_MODEL',
          unavailableReason: 'no speech captured in this window',
          scores: {
            authority: 0, coercion: 0, urgency: 0,
            financialInstruction: 0, secrecy: 0, credentialRequest: 0,
          },
          reliability: 0, windowMs: 0, transcriptChars: 0,
          modelVersion: providers.conversation.classifier.getModelInfo().modelVersion,
          backend: providers.conversation.classifier.getModelInfo().backend,
          timestamp: now(),
        };
        return unavailable;
      }
      const evidence = await providers.conversation.classifier.classify(window.text);
      return { ...evidence, windowMs: window.windowMs };
    }, now),
  };

  const notificationTool: InvestigationTool<NotificationEvidence> = {
    name: 'notificationTool',
    description: 'Do recent notifications use financial pressure language?',
    cost: 'LOW',
    execute: () => run('notificationTool', 'ANDROID_API', async () => {
      if (!providers.notification) {
        const unavailable: NotificationEvidence = {
          available: false, source: 'ANDROID_API',
          unavailableReason: 'notification access not granted',
          suspicion: 0, matchedCategories: [], count: 0, windowMs: 0,
        };
        return unavailable;
      }
      return providers.notification.getNotificationContext();
    }, now),
  };

  return [paymentTool, callContextTool, payeeTool, behaviourTool,
    conversationTool, notificationTool];
}
