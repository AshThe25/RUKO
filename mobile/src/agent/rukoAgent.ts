/**
 * The Ruko investigation agent. There is exactly one.
 *
 * WHAT MAKES IT AN AGENT: it decides, at run time and from partial evidence,
 * which of its six tools to call, in what order, and when it has learned enough
 * to stop. Cheap tools run first; their results determine whether the expensive
 * one is worth running at all; and a run can terminate early when no combination
 * of the remaining evidence could change the outcome.
 *
 * WHAT DOES NOT MAKE IT AN AGENT: an LLM. There is none, on purpose. A language
 * model in this loop would add latency, a model file, non-determinism and a
 * network dependency, to make a routing decision that six rules make correctly
 * and reproducibly. If a small local model ever routes better than these rules
 * — measurably — it can be swapped in behind the same interface.
 *
 * The agent gathers evidence. It never decides what to do about it: the
 * deterministic risk engine does that, from the evidence object the agent
 * produces.
 */

import type {
  InvestigationAgent, InvestigationContext, InvestigationResult, InvestigationTool,
  InvestigationTrigger, RiskEvidence, ToolName, TraceEntry,
} from '../contracts/index.ts';
import { evaluateRisk } from '../risk/riskEngine.ts';
import { FAMILY_MAX, THRESHOLDS } from '../risk/weights.ts';
import { createTools } from '../tools/index.ts';
import type { RukoProviders } from '../tools/providers.ts';

export const AGENT_VERSION = 'ruko-agent-v1';

/** Maximum points obtainable from everything except the conversation family. */
const NON_CONVERSATION_CEILING =
  FAMILY_MAX.PAYEE_BEHAVIOUR + FAMILY_MAX.CALL_CONTEXT + FAMILY_MAX.NOTIFICATION;

export interface AgentOptions {
  providers: RukoProviders;
  sessionId?: string;
  /**
   * Run every tool regardless of what the cheap ones found. Used by the
   * engineering screen and by tests that assert full-trace behaviour.
   */
  exhaustive?: boolean;
}

export class RukoAgent implements InvestigationAgent {
  private readonly tools: Map<ToolName, InvestigationTool>;
  private readonly now: () => number;
  private readonly options: AgentOptions;

  constructor(options: AgentOptions) {
    this.options = options;
    this.tools = new Map(createTools(options.providers).map((t) => [t.name, t]));
    this.now = options.providers.now ?? (() => Date.now());
  }

  async investigate(
    trigger: InvestigationTrigger,
    onTrace?: (entry: TraceEntry) => void,
  ): Promise<InvestigationResult> {
    const startedAt = this.now();
    const sessionId = this.options.sessionId ?? `ruko-${startedAt}-${Math.floor(Math.random() * 1e6)}`;
    const trace: TraceEntry[] = [];
    const failedTools: ToolName[] = [];
    let seq = 0;

    const emit = (
      kind: TraceEntry['kind'],
      message: string,
      tool?: ToolName,
      detail?: Record<string, unknown>,
    ): void => {
      const entry: TraceEntry = { timestamp: this.now(), seq: seq++, kind, message, tool, detail };
      trace.push(entry);
      onTrace?.(entry);
    };

    const ctx: InvestigationContext = {
      sessionId, startedAt, trigger, collected: {}, cancelled: false,
    };

    emit('STATE', 'Ruko is checking this payment', undefined, { trigger });

    const call = async (name: ToolName, why: string): Promise<void> => {
      const tool = this.tools.get(name);
      if (!tool) return;
      emit('TOOL_START', why, name);
      const result = await tool.execute(ctx);
      if (!result.ok) {
        failedTools.push(name);
        emit('ERROR', `Could not check ${describe(name)}`, name, { error: result.error });
        return;
      }
      assign(ctx, name, result.data);
      emit('TOOL_RESULT', summarise(name, result.data), name, {
        durationMs: result.durationMs, source: result.source,
      });
    };

    // --- Stage 1: cheap context. Always run. ------------------------- //
    await call('paymentTool', 'Looking at the payment');
    await call('callContextTool', 'Checking whether you are on a call');

    const paymentActive = ctx.collected.payment?.available === true
      && ctx.collected.payment.active;
    const callActive = ctx.collected.call?.available === true && ctx.collected.call.active;

    // --- Stage 2: local history. Only meaningful with a payment. ----- //
    if (paymentActive || this.options.exhaustive) {
      await call('payeeTool', 'Checking whether you have paid this recipient before');
      await call('behaviourTool', 'Comparing this against how you normally pay');
    } else {
      emit('STATE', 'No payment in progress, so recipient history was not needed');
    }

    await call('notificationTool', 'Looking at recent messages');

    // --- Stage 3: the expensive one, run only when it can matter. ---- //
    const shouldListen = this.options.exhaustive
      || callActive
      || paymentActive
      || trigger === 'SUSPICIOUS_CONVERSATION'
      || trigger === 'DEMO';

    if (shouldListen) {
      await call('conversationTool', 'Listening to the conversation for pressure tactics');
    } else {
      emit('STATE',
        'Skipped conversation analysis: no call and no payment, so it could not change the outcome');
    }

    // --- Fusion and scoring. --------------------------------------- //
    const evidence = materialise(ctx, sessionId, this.now());
    emit('FUSION', 'Combining what was found', undefined, {
      available: {
        conversation: evidence.conversation.available,
        payment: evidence.payment.available,
        payee: evidence.payee.available,
        behaviour: evidence.behaviour.available,
        call: evidence.call.available,
      },
    });

    const risk = evaluateRisk(evidence);
    emit('RISK', `Risk ${risk.score} out of 100 — ${risk.level}`, undefined, {
      score: risk.score, level: risk.level,
      corroboratingFamilies: risk.corroboratingFamilies,
      topReasons: risk.reasons.slice(0, 4).map((r) => r.code),
    });
    emit('POLICY', policyMessage(risk.policyAction), undefined, {
      policyAction: risk.policyAction,
      escalateToGuardian: risk.escalateToGuardian,
      degraded: risk.degraded,
    });

    const completedAt = this.now();
    return {
      sessionId, trigger,
      state: risk.escalateToGuardian ? 'GUARDIAN_ESCALATION'
        : risk.policyAction === 'NONE' ? 'RESOLVED' : 'INTERVENTION',
      evidence, risk, trace,
      startedAt, completedAt, totalMs: completedAt - startedAt,
      failedTools,
    };
  }

  /**
   * Could the evidence gathered so far still reach a level worth interrupting
   * for, in the best case for the signals not yet gathered? Used to justify
   * skipping the expensive tool. Exposed for testing the reasoning directly.
   */
  static couldStillMatter(conversationPending: boolean, pointsSoFar: number): boolean {
    const ceiling = pointsSoFar + (conversationPending ? FAMILY_MAX.CONVERSATION : 0);
    return ceiling >= THRESHOLDS.MEDIUM;
  }
}

export { NON_CONVERSATION_CEILING };

// ---------------------------------------------------------------------- //
// helpers
// ---------------------------------------------------------------------- //

function assign(ctx: InvestigationContext, name: ToolName, data: unknown): void {
  const c = ctx.collected as Record<string, unknown>;
  const key = ({
    paymentTool: 'payment', callContextTool: 'call', payeeTool: 'payee',
    behaviourTool: 'behaviour', conversationTool: 'conversation',
    notificationTool: 'notification',
  } as Record<ToolName, string>)[name];
  if (key) c[key] = data;
}

function describe(name: ToolName): string {
  return ({
    paymentTool: 'the payment', callContextTool: 'the call',
    payeeTool: 'the recipient', behaviourTool: 'your payment history',
    conversationTool: 'the conversation', notificationTool: 'recent messages',
  } as Record<ToolName, string>)[name];
}

/** One short, already user-readable line for the live investigation feed. */
function summarise(name: ToolName, data: unknown): string {
  const d = data as Record<string, any>;
  switch (name) {
    case 'paymentTool':
      if (!d?.available || !d.active) return 'No payment in progress';
      return d.amountMinor === null
        ? 'A payment is open, amount not readable'
        : `Payment of ₹${(d.amountMinor / 100).toLocaleString('en-IN')}`
          + (d.payeeDisplayName ? ` to ${d.payeeDisplayName}` : '');
    case 'callContextTool':
      if (!d?.available) return 'Call status unavailable';
      if (!d.active) return 'Not on a call';
      return d.callerKnown === false ? 'On a call with an unknown number'
        : d.callerKnown === true ? 'On a call with a saved contact'
          : 'On a call';
    case 'payeeTool':
      if (!d?.available) return 'Recipient could not be identified';
      if (d.userTrusted) return 'Recipient is one you have marked trusted';
      return d.known
        ? `You have paid this recipient ${d.previousTransactions} time(s) before`
        : 'First time paying this recipient';
    case 'behaviourTool':
      if (!d?.available) return 'No amount to compare';
      if (!d.profileMature) return 'Not enough history yet to judge this amount';
      if (!d.amountRatio || d.amountAnomaly === 0) return 'Amount is normal for you';
      return `Amount is ${d.amountRatio.toFixed(1)}× your usual`;
    case 'conversationTool': {
      // Speech and message text are the same model on the same tactics, but
      // they are not the same claim to the user. Ruko says which one it read.
      const fromMessages = d?.textSource === 'MESSAGES';
      if (!d?.available) return 'Nothing was heard';
      if (d.reliability < 0.35) {
        return fromMessages ? 'Too little message text to assess' : 'Too little speech to assess';
      }
      const top = Object.entries(d.scores as Record<string, number>)
        .filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length === 0) {
        return fromMessages ? 'No pressure tactics in your messages' : 'No pressure tactics detected';
      }
      const detected = top
        .map(([k, v]) => `${LABEL_COPY[k] ?? k} ${Math.round(v * 100)}%`)
        .join(', ');
      return fromMessages ? `In your messages: ${detected}` : `Detected: ${detected}`;
    }
    case 'notificationTool':
      if (!d?.available) return 'Notification access not granted';
      return d.count === 0 ? 'No recent payment messages'
        : `${d.count} recent message(s) using financial pressure language`;
    default:
      return name;
  }
}

const LABEL_COPY: Record<string, string> = {
  authority: 'authority claim', coercion: 'coercion', urgency: 'urgency',
  financialInstruction: 'payment instruction', secrecy: 'secrecy',
  credentialRequest: 'credential request',
};

function policyMessage(action: string): string {
  switch (action) {
    case 'BLOCK_WARNING': return 'Stopping to warn you before this payment';
    case 'STRONG_WARNING': return 'Showing a warning before this payment';
    case 'SUBTLE_WARNING': return 'Showing a quiet notice';
    default: return 'Nothing looks wrong — staying out of the way';
  }
}

/**
 * Fill every gap with an explicitly unavailable block. The risk engine must
 * never receive `undefined` and quietly treat it as a zero.
 */
function materialise(ctx: InvestigationContext, sessionId: string, now: number): RiskEvidence {
  const c = ctx.collected;
  return {
    sessionId,
    timestamp: now,
    conversation: c.conversation ?? {
      available: false, source: 'ON_DEVICE_MODEL',
      unavailableReason: 'conversation was not analysed in this investigation',
      scores: {
        authority: 0, coercion: 0, urgency: 0,
        financialInstruction: 0, secrecy: 0, credentialRequest: 0,
      },
      reliability: 0, windowMs: 0, transcriptChars: 0,
      modelVersion: 'none', backend: 'UNAVAILABLE', timestamp: now,
    },
    payment: c.payment ?? {
      available: false, source: 'MOCK', unavailableReason: 'payment context tool did not run',
      active: false, amountMinor: null, currency: 'INR',
      payeeDisplayName: null, payeeHash: null, timestamp: now,
    },
    payee: c.payee ?? {
      available: false, source: 'LOCAL_STORE', unavailableReason: 'payee tool did not run',
      known: false, previousTransactions: 0, averageAmountMinor: null, maxAmountMinor: null,
      firstSeen: null, lastSeen: null, ageDays: null, userTrusted: false,
    },
    behaviour: c.behaviour ?? {
      available: false, source: 'LOCAL_STORE', unavailableReason: 'behaviour tool did not run',
      amountRatio: null, amountAnomaly: 0, medianAmountMinor: null, meanAmountMinor: null,
      p95AmountMinor: null, frequencyAnomaly: 0, timeAnomaly: 0,
      sampleSize: 0, profileMature: false,
    },
    call: c.call ?? {
      available: false, source: 'ANDROID_API', unavailableReason: 'call tool did not run',
      active: false, callerKnown: null, direction: 'UNKNOWN',
      durationMs: null, startedBeforePayment: null,
    },
    notification: c.notification,
  };
}
