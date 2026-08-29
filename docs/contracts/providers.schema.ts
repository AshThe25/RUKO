/**
 * Ruko shared contracts — device context providers and the mobile service
 * container.
 * Contract version: contracts-v1.1 (additive)
 *
 * PROPOSED BY: Aishwarya (mobile). The *implementations* of the device
 * providers belong to Puneesh (Android) and Vedant (classifier / risk / agent);
 * this file only fixes the shape the mobile layer subscribes to, so the UI can
 * be built and tested before the native layer exists.
 *
 * Puneesh / Vedant: if a signature here does not fit what Android or the
 * runtime can actually give us, change it and add a CHANGELOG entry — this is a
 * proposal, not a decree. Nothing in `mobile/src/screens` touches a provider
 * directly; everything goes through `RukoServices` below, so a change here
 * costs one adapter, not twenty screens.
 */

import type { EvidenceSource, Timestamp } from './common.schema';
import type { ConversationEvidence, InferenceBackend, ModelInfo } from './conversation.schema';
import type {
  BehaviourEvidence,
  CallEvidence,
  NotificationEvidence,
  PayeeEvidence,
  PaymentEvidence,
  TransactionRecord,
} from './payment.schema';
import type { GuardianChannel } from './guardian.schema';
import type { InvestigationAgent } from './investigation.schema';
import type { RiskEngine } from './risk.schema';

export type Unsubscribe = () => void;

/**
 * Every provider reports how it obtained its data and stays subscribable.
 * `read()` is a one-shot for the investigation agent's tools; `subscribe()` is
 * what keeps the UI live.
 */
export interface ContextProvider<T> {
  readonly source: EvidenceSource;
  read(): Promise<T>;
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export type CallContextProvider = ContextProvider<CallEvidence>;
export type PaymentContextProvider = ContextProvider<PaymentEvidence>;
export type NotificationContextProvider = ContextProvider<NotificationEvidence>;

/**
 * A protected listening session. Audio is processed in RAM and discarded;
 * only derived ConversationEvidence crosses this boundary.
 */
export interface ConversationProvider {
  readonly source: EvidenceSource;
  start(sessionId: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  read(): Promise<ConversationEvidence>;
  subscribe(listener: (value: ConversationEvidence) => void): Unsubscribe;
}

/** Local-only behaviour + payee history. Never leaves the device. */
export interface BehaviourStore {
  readonly source: EvidenceSource;
  getBehaviour(amountMinor: number | null): Promise<BehaviourEvidence>;
  getPayee(payeeHash: string | null): Promise<PayeeEvidence>;
  listTransactions(limit?: number): Promise<TransactionRecord[]>;
  recordTransaction(tx: TransactionRecord): Promise<void>;
  /** Used by the demo to seed a realistic history. Test/demo builds only. */
  seed(transactions: TransactionRecord[]): Promise<void>;
}

/**
 * What the engineering screen shows. Every field is a measurement or an
 * explicit "unknown" — nothing here may be hardcoded for a demo.
 */
export interface EngineDiagnostics {
  classifier: ModelInfo;
  asr: {
    available: boolean;
    local: boolean;
    modelVersion: string | null;
    backend: InferenceBackend;
    lastLatencyMs: number | null;
  };
  riskEngine: { engineVersion: string; weightsVersion: string; policyVersion: string };
  /** True when the device has no network. Core protection does not need one. */
  offline: boolean;
  deviceModel: string | null;
  lastUpdated: Timestamp;
}

export interface DiagnosticsProvider {
  read(): Promise<EngineDiagnostics>;
  subscribe(listener: (value: EngineDiagnostics) => void): Unsubscribe;
}

/**
 * Everything the mobile app depends on, injected in one place
 * (`mobile/src/services/createServices.ts`). Swapping a stub for a real
 * implementation is a one-line change there; no screen knows the difference.
 */
export interface RukoServices {
  call: CallContextProvider;
  payment: PaymentContextProvider;
  notification: NotificationContextProvider;
  conversation: ConversationProvider;
  behaviour: BehaviourStore;
  risk: RiskEngine;
  agent: InvestigationAgent;
  guardian: GuardianChannel;
  diagnostics: DiagnosticsProvider;
}
