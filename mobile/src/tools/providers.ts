/**
 * Provider interfaces — the seam between Ruko's investigation tools and the
 * device.
 *
 * The tools depend only on these. Puneesh's Android implementations, the demo
 * app and the test fakes all satisfy the same shapes, which is why the agent and
 * the risk engine can be tested end to end without an emulator, and why nothing
 * in the risk layer is hard-coded to one UPI app.
 *
 * Every method may fail. Failure is expected, not exceptional: permissions get
 * revoked, accessibility trees change shape, the mic is busy. Tools convert
 * failures into unavailable evidence rather than letting them abort a run.
 */

import type {
  CallEvidence, ConversationEvidence, LocalRiskClassifier, NotificationEvidence,
  PaymentEvidence, TransactionRecord,
} from '../contracts/index.ts';

export interface ConversationProvider {
  /**
   * The most recent transcript window, or null when nothing has been heard.
   * Session memory only — implementations must not persist this.
   */
  getRecentTranscript(): Promise<{ text: string; windowMs: number; asrConfidence: number } | null>;
  classifier: LocalRiskClassifier;

  /**
   * Optional: return already-classified evidence instead of a transcript.
   *
   * Two valid places to run the classifier: inside the provider, or inside the
   * conversationTool. The mobile app runs it in the provider, because the live
   * investigation screen subscribes to evidence rather than to text. When this
   * is present the tool uses it directly and does not classify again --
   * classifying twice would double the only expensive call in the pipeline.
   */
  readEvidence?(): Promise<ConversationEvidence>;
}

export interface PaymentProvider {
  /** Current payment surface, if any. Source must reflect how it was obtained. */
  getPaymentContext(): Promise<PaymentEvidence>;
}

export interface CallProvider {
  getCallContext(): Promise<CallEvidence>;
}

export interface NotificationProvider {
  getNotificationContext(): Promise<NotificationEvidence>;
}

export interface HistoryStore {
  /** Local transaction history, newest last. */
  getTransactions(): Promise<TransactionRecord[]>;
  /** Payee hashes the user has explicitly marked trusted. */
  getTrustedPayees(): Promise<ReadonlySet<string>>;
}

export interface RukoProviders {
  conversation: ConversationProvider;
  payment: PaymentProvider;
  call: CallProvider;
  history: HistoryStore;
  notification?: NotificationProvider;
  /** Injected so every test and the demo are deterministic. */
  now?: () => number;
}
