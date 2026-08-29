/**
 * In-memory providers for Demo Mode and for tests.
 *
 * DEMO MODE HONESTY RULE (master spec §57): the demo controls the *inputs* — a
 * scripted transcript, a controlled payment screen, a seeded transaction history
 * — and nothing else. The classifier, the behaviour engine, the payee engine,
 * the agent, the risk engine and the policy all run for real, exactly as they do
 * on live data. Nothing here ever sets a score.
 *
 * Every provider reports `source: 'DEMO'`, which the engineering screen and the
 * audit trail display verbatim, so a demo-sourced payment can never be mistaken
 * for an intercepted real UPI transaction.
 */

import type {
  CallEvidence, LocalRiskClassifier, NotificationEvidence,
  PaymentEvidence, TransactionRecord,
} from '../contracts/index.ts';
import { hashPayee } from '../risk/hash.ts';
import type {
  CallProvider, ConversationProvider, HistoryStore,
  NotificationProvider, PaymentProvider,
} from './providers.ts';

export const DEMO_SALT = 'ruko-demo-device-salt-0001';

export class DemoConversationProvider implements ConversationProvider {
  private window: { text: string; windowMs: number; asrConfidence: number } | null = null;
  public classifier: LocalRiskClassifier;

  constructor(classifier: LocalRiskClassifier) {
    this.classifier = classifier;
  }

  /** Feed the scripted transcript. The classifier still has to work it out. */
  setTranscript(text: string, windowMs = 8000, asrConfidence = 0.92): void {
    this.window = { text, windowMs, asrConfidence };
  }

  clear(): void {
    this.window = null;
  }

  async getRecentTranscript() {
    return this.window;
  }
}

export class DemoPaymentProvider implements PaymentProvider {
  private state: PaymentEvidence;

  constructor(now: number = Date.now()) {
    this.state = {
      available: true, source: 'DEMO', active: false,
      amountMinor: null, currency: 'INR',
      payeeDisplayName: null, payeeHash: null, timestamp: now,
    };
  }

  /** Simulate the user reaching a payment confirmation screen. */
  openPayment(payeeDisplayName: string, amountMinor: number, now: number = Date.now()): void {
    this.state = {
      available: true, source: 'DEMO', active: true,
      amountMinor, currency: 'INR', payeeDisplayName,
      payeeHash: hashPayee(payeeDisplayName, DEMO_SALT),
      appPackage: 'com.ruko.paydemo', timestamp: now,
    };
  }

  closePayment(now: number = Date.now()): void {
    this.state = { ...this.state, active: false, amountMinor: null,
      payeeDisplayName: null, payeeHash: null, timestamp: now };
  }

  /** Simulate a screen Ruko cannot parse — a real and common failure. */
  setUnreadable(reason = 'payment screen layout not recognised'): void {
    this.state = { ...this.state, available: false, unavailableReason: reason };
  }

  async getPaymentContext(): Promise<PaymentEvidence> {
    return this.state;
  }
}

export class DemoCallProvider implements CallProvider {
  private state: CallEvidence = {
    available: true, source: 'DEMO', active: false, callerKnown: null,
    direction: 'UNKNOWN', durationMs: null, startedBeforePayment: null,
  };

  startCall(opts: { callerKnown: boolean | null; durationMs?: number;
    direction?: CallEvidence['direction']; startedBeforePayment?: boolean } ): void {
    this.state = {
      available: true, source: 'DEMO', active: true,
      callerKnown: opts.callerKnown,
      direction: opts.direction ?? 'INCOMING',
      durationMs: opts.durationMs ?? 300_000,
      startedBeforePayment: opts.startedBeforePayment ?? true,
    };
  }

  endCall(): void {
    this.state = { ...this.state, active: false, durationMs: null,
      callerKnown: null, startedBeforePayment: null };
  }

  setUnavailable(reason = 'phone state permission not granted'): void {
    this.state = { ...this.state, available: false, unavailableReason: reason };
  }

  async getCallContext(): Promise<CallEvidence> {
    return this.state;
  }
}

export class DemoNotificationProvider implements NotificationProvider {
  private state: NotificationEvidence = {
    available: true, source: 'DEMO', suspicion: 0,
    matchedCategories: [], count: 0, windowMs: 600_000,
  };

  setNotifications(suspicion: number, categories: string[], count: number): void {
    this.state = { available: true, source: 'DEMO', suspicion,
      matchedCategories: categories, count, windowMs: 600_000 };
  }

  async getNotificationContext(): Promise<NotificationEvidence> {
    return this.state;
  }
}

export class InMemoryHistoryStore implements HistoryStore {
  private transactions: TransactionRecord[] = [];
  private trusted = new Set<string>();

  seed(transactions: TransactionRecord[], trustedPayeeNames: string[] = []): void {
    this.transactions = [...transactions];
    this.trusted = new Set(trustedPayeeNames.map((n) => hashPayee(n, DEMO_SALT)));
  }

  add(record: TransactionRecord): void {
    this.transactions.push(record);
  }

  async getTransactions(): Promise<TransactionRecord[]> {
    return this.transactions;
  }

  async getTrustedPayees(): Promise<ReadonlySet<string>> {
    return this.trusted;
  }
}

/**
 * A plausible spending history for a demo user: mostly small everyday payments
 * to a handful of familiar recipients, plus a monthly rent transfer.
 *
 * This is what makes the two large payments in the demo distinguishable. Both
 * are ~50,000; one goes to `Landlord`, who appears here every month, and one
 * goes to a name that has never appeared. The engine is not told which is which.
 */
export function demoHistory(now: number): TransactionRecord[] {
  const DAY = 86_400_000;
  const records: TransactionRecord[] = [];
  let i = 0;

  const add = (payee: string, rupees: number, daysAgo: number, hour: number): void => {
    records.push({
      id: `demo-${i++}`,
      payeeHash: hashPayee(payee, DEMO_SALT),
      amountMinor: rupees * 100,
      timestamp: now - daysAgo * DAY - hour * 3_600_000,
    });
  };

  // A small deterministic PRNG, so the demo history is identical on every run
  // and on every machine. Math.random() here would make the demo unrepeatable.
  let seed = 0x9e3779b9;
  const rand = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  const everyday = ['Kirana Store', 'Swiggy', 'Metro Card', 'Chemist', 'Arjun', 'Priya'];
  const midsize = ['Electricity Board', 'Phone Bill', 'Amazon', 'Insurance'];

  // ~150 days of ordinary life: several small payments a week, an occasional
  // mid-size bill, and rent on the fifth of every month.
  for (let day = 150; day >= 1; day--) {
    const paymentsToday = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0;
    for (let n = 0; n < paymentsToday; n++) {
      // Small everyday spend, 120 to 1,600 rupees, skewed low.
      const amount = Math.round(120 + rand() * rand() * 1500);
      add(pick(everyday), amount, day, 9 + Math.floor(rand() * 12));
    }
    // A larger bill roughly every couple of weeks: 2,500 to 14,000.
    if (rand() < 0.07) {
      add(pick(midsize), Math.round(2500 + rand() * 11500), day, 10 + Math.floor(rand() * 8));
    }
    // Rent, monthly, always to the same recipient.
    if (day % 30 === 5) add('Landlord', 50_000, day, 11);
  }

  return records.sort((a, b) => a.timestamp - b.timestamp);
}
