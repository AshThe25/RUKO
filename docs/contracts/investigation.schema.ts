/**
 * Ruko shared contracts — the investigation agent's trace.
 * Contract version: contracts-v1
 *
 * Ruko runs ONE investigation agent with several tools. The agent decides WHICH
 * evidence to gather; it does not decide what to do about it. The trace below is
 * both the live UI feed ("RUKO IS CHECKING...") and the audit record.
 *
 * Owner: Vedant.
 */

import type { EvidenceSource, Timestamp } from './common.schema';
import type { RiskEvidence, RiskResult } from './risk.schema';

export const INVESTIGATION_STATES = [
  'IDLE',
  'MONITORING',
  'PAYMENT_WATCH',
  'INVESTIGATION',
  'INTERVENTION',
  'GUARDIAN_ESCALATION',
  'RESOLVED',
] as const;
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];

export const TOOL_NAMES = [
  'conversationTool',
  'paymentTool',
  'payeeTool',
  'behaviourTool',
  'callContextTool',
  'notificationTool',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolResult<T = unknown> {
  tool: ToolName;
  ok: boolean;
  data: T | null;
  /** Present when ok === false. The agent continues; it never throws away the run. */
  error?: string;
  source: EvidenceSource;
  durationMs: number;
  timestamp: Timestamp;
}

/**
 * A tool the investigation agent can call. Tools are pure evidence gatherers:
 * they must not score, decide, or mutate app state.
 */
export interface InvestigationTool<T = unknown> {
  name: ToolName;
  description: string;
  /** Cheap tools run first. Used by the agent's scheduling. */
  cost: 'LOW' | 'MEDIUM' | 'HIGH';
  execute(context: InvestigationContext): Promise<ToolResult<T>>;
}

export interface InvestigationContext {
  sessionId: string;
  startedAt: Timestamp;
  /** Why the investigation was triggered at all. */
  trigger: InvestigationTrigger;
  /** Evidence gathered so far, so later tools can adapt. */
  collected: Partial<RiskEvidence>;
  /** Set when the user or the system aborts. Tools must respect it. */
  cancelled: boolean;
}

export type InvestigationTrigger =
  | 'PAYMENT_SCREEN_DETECTED'
  | 'CALL_DURING_PAYMENT'
  | 'SUSPICIOUS_CONVERSATION'
  | 'SUSPICIOUS_NOTIFICATION'
  | 'MANUAL'
  | 'DEMO';

/** One line in the live "RUKO IS CHECKING" feed and in the audit log. */
export interface TraceEntry {
  timestamp: Timestamp;
  seq: number;
  kind: 'STATE' | 'TOOL_START' | 'TOOL_RESULT' | 'FUSION' | 'RISK' | 'POLICY' | 'ERROR';
  /** One short line, already user-readable. e.g. "Recipient — first payment". */
  message: string;
  tool?: ToolName;
  /** Machine-readable detail for the engineering screen. */
  detail?: Record<string, unknown>;
}

export interface InvestigationResult {
  sessionId: string;
  trigger: InvestigationTrigger;
  state: InvestigationState;
  evidence: RiskEvidence;
  risk: RiskResult;
  trace: TraceEntry[];
  startedAt: Timestamp;
  completedAt: Timestamp;
  totalMs: number;
  /** Tools that failed. The investigation still completes, marked degraded. */
  failedTools: ToolName[];
}

export interface InvestigationAgent {
  investigate(
    trigger: InvestigationTrigger,
    onTrace?: (entry: TraceEntry) => void,
  ): Promise<InvestigationResult>;
}
