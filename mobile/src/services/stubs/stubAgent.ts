/**
 * STUB — the single investigation agent.
 *
 * Deterministic orchestration, not an LLM: the agent decides *which* evidence
 * to gather and in what order, gathers it through tools, fuses it, and hands
 * the result to the risk engine. It never decides what to do about it.
 *
 * Replaced by `mobile/src/agent/` + `mobile/src/tools/` (Vedant). The trace it
 * emits already matches the contract, so the investigation screen does not
 * change when that lands.
 */
import type {
  BehaviourStore,
  CallContextProvider,
  ConversationProvider,
  InvestigationAgent,
  InvestigationResult,
  InvestigationTrigger,
  NotificationContextProvider,
  PaymentContextProvider,
  RiskEngine,
  RiskEvidence,
  ToolName,
  ToolResult,
  TraceEntry,
} from '@contracts';
import {formatMinor, formatRatio} from '@/utils/format';
import {newId, now} from '@/utils/id';

interface AgentDeps {
  call: CallContextProvider;
  payment: PaymentContextProvider;
  notification: NotificationContextProvider;
  conversation: ConversationProvider;
  behaviour: BehaviourStore;
  risk: RiskEngine;
}

export function createStubAgent(deps: AgentDeps): InvestigationAgent {
  return {
    async investigate(
      trigger: InvestigationTrigger,
      onTrace?: (entry: TraceEntry) => void,
    ): Promise<InvestigationResult> {
      const sessionId = newId('sess');
      const startedAt = now();
      const trace: TraceEntry[] = [];
      const failedTools: ToolName[] = [];
      let seq = 0;

      const emit = (entry: Omit<TraceEntry, 'seq' | 'timestamp'>) => {
        const full: TraceEntry = {...entry, seq: seq++, timestamp: now()};
        trace.push(full);
        onTrace?.(full);
        return full;
      };

      const run = async <T>(
        tool: ToolName,
        label: string,
        fn: () => Promise<T>,
        describe: (value: T) => string,
      ): Promise<ToolResult<T>> => {
        emit({kind: 'TOOL_START', tool, message: label});
        const toolStart = now();
        try {
          const data = await fn();
          const result: ToolResult<T> = {
            tool,
            ok: true,
            data,
            source: 'DEMO',
            durationMs: now() - toolStart,
            timestamp: now(),
          };
          emit({
            kind: 'TOOL_RESULT',
            tool,
            message: describe(data),
            detail: {durationMs: result.durationMs},
          });
          return result;
        } catch (error) {
          failedTools.push(tool);
          const message = error instanceof Error ? error.message : String(error);
          emit({kind: 'ERROR', tool, message: `${label} unavailable`, detail: {error: message}});
          return {
            tool,
            ok: false,
            data: null,
            error: message,
            source: 'DEMO',
            durationMs: now() - toolStart,
            timestamp: now(),
          };
        }
      };

      emit({kind: 'STATE', message: 'Investigation started', detail: {trigger}});

      // Cheap, deterministic context first — it decides whether the expensive
      // conversation evidence is even worth asking for.
      const payment = await run(
        'paymentTool',
        'Payment',
        () => deps.payment.read(),
        p =>
          p.active
            ? `${formatMinor(p.amountMinor)} to ${p.payeeDisplayName ?? 'an unnamed recipient'}`
            : 'No payment in progress',
      );

      const call = await run(
        'callContextTool',
        'Caller',
        () => deps.call.read(),
        c => {
          if (!c.available) {
            return 'Call state unavailable';
          }
          if (!c.active) {
            return 'Not on a call';
          }
          return c.callerKnown === false ? 'Unknown caller' : 'Known caller';
        },
      );

      const payee = await run(
        'payeeTool',
        'Recipient',
        () => deps.behaviour.getPayee(payment.data?.payeeHash ?? null),
        p => {
          if (!p.available) {
            return 'No recipient history';
          }
          return p.known
            ? `${p.previousTransactions} previous payments`
            : 'First payment to this recipient';
        },
      );

      const behaviour = await run(
        'behaviourTool',
        'Amount',
        () => deps.behaviour.getBehaviour(payment.data?.amountMinor ?? null),
        b => {
          if (!b.available) {
            return 'No payment history yet';
          }
          if (!b.profileMature) {
            return `Only ${b.sampleSize} payments on record — not enough to judge`;
          }
          if (b.amountRatio === null || b.amountRatio <= 1.2) {
            return 'In line with your usual payments';
          }
          return `${formatRatio(b.amountRatio)} your usual payment`;
        },
      );

      const notification = await run(
        'notificationTool',
        'Notifications',
        () => deps.notification.read(),
        n =>
          n.available
            ? `${n.count} recent message${n.count === 1 ? '' : 's'} using pressure language`
            : 'No notification access',
      );

      const conversation = await run(
        'conversationTool',
        'Conversation',
        () => deps.conversation.read(),
        c => {
          if (!c.available) {
            return c.unavailableReason ?? 'No conversation analysed';
          }
          const top = topSignal(c.scores);
          if (!top) {
            return 'Nothing concerning in what was said';
          }
          return `${SIGNAL_COPY[top.label]} detected`;
        },
      );

      emit({kind: 'FUSION', message: 'Evidence fused'});

      const evidence: RiskEvidence = {
        sessionId,
        timestamp: now(),
        conversation: conversation.data!,
        payment: payment.data!,
        payee: payee.data!,
        behaviour: behaviour.data!,
        call: call.data!,
        notification: notification.data ?? undefined,
      };

      const risk = deps.risk.evaluate(evidence);

      emit({
        kind: 'RISK',
        message: `Risk ${risk.score}/100`,
        detail: {
          score: risk.score,
          level: risk.level,
          computeMs: risk.computeMs,
          corroboratingFamilies: risk.corroboratingFamilies,
        },
      });
      emit({
        kind: 'POLICY',
        message: POLICY_COPY[risk.policyAction],
        detail: {policyAction: risk.policyAction, policyVersion: risk.policyVersion},
      });

      const completedAt = now();
      return {
        sessionId,
        trigger,
        state: risk.level === 'CRITICAL' ? 'INTERVENTION' : 'RESOLVED',
        evidence,
        risk,
        trace,
        startedAt,
        completedAt,
        totalMs: completedAt - startedAt,
        failedTools,
      };
    },
  };
}

const SIGNAL_COPY: Record<string, string> = {
  authority: 'Authority impersonation',
  coercion: 'Coercion',
  urgency: 'Urgency',
  financialInstruction: 'Payment instruction',
  secrecy: 'Secrecy request',
  credentialRequest: 'Credential request',
};

const POLICY_COPY: Record<string, string> = {
  NONE: 'No interruption needed',
  SUBTLE_WARNING: 'Show a passive warning',
  STRONG_WARNING: 'Warn before continuing',
  BLOCK_WARNING: 'Stop and explain before any payment',
};

function topSignal(scores: Record<string, number>): {label: string; score: number} | null {
  let best: {label: string; score: number} | null = null;
  for (const [label, score] of Object.entries(scores)) {
    if (score >= 0.5 && (!best || score > best.score)) {
      best = {label, score};
    }
  }
  return best;
}
