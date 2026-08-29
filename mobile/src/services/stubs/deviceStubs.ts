/**
 * STUB — device context providers.
 *
 * Stands in for Puneesh's Android layer: call state, the payment surface,
 * notification context, and the local behaviour/payee store. Every value here
 * is tagged `source: 'DEMO'` or `'LOCAL_STORE'`, so the audit trail and the
 * engineering screen can always tell the user this did not come from a real
 * Android API.
 *
 * The behaviour statistics are NOT stubbed — median / p95 / anomaly are really
 * computed from the seeded history, because that maths is what makes the
 * false-positive cases (rent, a known friend) come out low, and a faked
 * version of it would prove nothing.
 */
import {
  clamp01,
  type BehaviourEvidence,
  type BehaviourStore,
  type CallContextProvider,
  type CallEvidence,
  type ConversationEvidence,
  type ConversationProvider,
  type NotificationContextProvider,
  type NotificationEvidence,
  type PayeeEvidence,
  type PaymentContextProvider,
  type PaymentEvidence,
  type TransactionRecord,
  type Unsubscribe,
} from '@contracts';
import {rupeesToMinor} from '@/utils/format';
import {newId, now} from '@/utils/id';
import {Emitter} from './emitter';
import {LexicalClassifier, STUB_MODEL_VERSION} from './lexicalClassifier';
import {SCENARIOS, type Scenario, type ScenarioId} from './scenarios';

const MIN_MATURE_SAMPLE = 5;

const IDLE_CALL: CallEvidence = {
  available: true,
  source: 'DEMO',
  active: false,
  callerKnown: null,
  direction: 'UNKNOWN',
  durationMs: null,
  startedBeforePayment: null,
};

const IDLE_PAYMENT: PaymentEvidence = {
  available: true,
  source: 'DEMO',
  active: false,
  amountMinor: null,
  currency: 'INR',
  payeeDisplayName: null,
  payeeHash: null,
  timestamp: 0,
};

const NO_NOTIFICATIONS: NotificationEvidence = {
  available: false,
  source: 'DEMO',
  unavailableReason: 'Notification access has not been granted.',
  suspicion: 0,
  matchedCategories: [],
  count: 0,
  windowMs: 0,
};

const EMPTY_CONVERSATION = (): ConversationEvidence => ({
  available: false,
  source: 'ON_DEVICE_HEURISTIC',
  unavailableReason: 'No speech has been analysed in this session yet.',
  scores: {
    authority: 0,
    coercion: 0,
    urgency: 0,
    financialInstruction: 0,
    secrecy: 0,
    credentialRequest: 0,
  },
  reliability: 0,
  windowMs: 0,
  transcriptChars: 0,
  modelVersion: STUB_MODEL_VERSION,
  backend: 'HEURISTIC',
  detectedLanguage: 'unknown',
  timestamp: 0,
});

/**
 * The one place demo state lives. Screens never touch it directly — they go
 * through the providers, exactly as they will with the real Android layer.
 */
export class StubDeviceBus {
  readonly call = new Emitter<CallEvidence>(IDLE_CALL);
  readonly payment = new Emitter<PaymentEvidence>(IDLE_PAYMENT);
  readonly notification = new Emitter<NotificationEvidence>(NO_NOTIFICATIONS);
  readonly conversation = new Emitter<ConversationEvidence>(EMPTY_CONVERSATION());
  readonly transcript = new Emitter<string[]>([]);

  private classifier = new LexicalClassifier();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private scenario: Scenario | null = null;
  private running = false;

  async init(): Promise<void> {
    await this.classifier.loadModel();
  }

  getScenario(): Scenario | null {
    return this.scenario;
  }

  getClassifier(): LexicalClassifier {
    return this.classifier;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Loads a scenario's static context. Does not start the conversation. */
  loadScenario(id: ScenarioId): Scenario {
    this.reset();
    const scenario = SCENARIOS[id];
    this.scenario = scenario;

    this.call.emit({
      available: true,
      source: 'DEMO',
      active: scenario.call.active,
      callerKnown: scenario.call.callerKnown,
      direction: scenario.call.direction,
      durationMs: scenario.call.active ? 0 : null,
      startedBeforePayment: scenario.call.startedBeforePayment,
    });

    this.notification.emit(
      scenario.notification
        ? {
            available: true,
            source: 'DEMO',
            suspicion: clamp01(scenario.notification.suspicion),
            matchedCategories: scenario.notification.matchedCategories,
            count: scenario.notification.count,
            windowMs: 24 * 60 * 60 * 1000,
          }
        : NO_NOTIFICATIONS,
    );

    return scenario;
  }

  /** Plays the scripted conversation through the classifier, in real time. */
  async startConversation(): Promise<void> {
    const scenario = this.scenario;
    if (!scenario || this.running) {
      return;
    }
    this.running = true;
    const spoken: string[] = [];

    for (const line of scenario.lines) {
      const timer = setTimeout(async () => {
        spoken.push(line.text);
        this.transcript.emit([...spoken]);
        // Real text, really classified. Nothing here short-circuits.
        const evidence = await this.classifier.classify(spoken.join(' '));
        this.conversation.emit(evidence);
      }, line.atMs);
      this.timers.push(timer);
    }
  }

  stopConversation(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.running = false;
  }

  /** The user has reached a payment confirmation surface. */
  openPayment(amountMinor: number, payeeDisplayName: string, payeeHash: string): void {
    this.payment.emit({
      available: true,
      source: 'DEMO',
      active: true,
      amountMinor,
      currency: 'INR',
      payeeDisplayName,
      payeeHash,
      appPackage: 'com.ruko.paydemo',
      timestamp: now(),
    });
  }

  closePayment(): void {
    this.payment.emit({...IDLE_PAYMENT, timestamp: now()});
  }

  reset(): void {
    this.stopConversation();
    this.scenario = null;
    this.call.emit(IDLE_CALL);
    this.payment.emit({...IDLE_PAYMENT});
    this.notification.emit(NO_NOTIFICATIONS);
    this.conversation.emit(EMPTY_CONVERSATION());
    this.transcript.emit([]);
  }
}

export function createCallProvider(bus: StubDeviceBus): CallContextProvider {
  return {
    source: 'DEMO',
    read: async () => bus.call.value,
    subscribe: (l): Unsubscribe => bus.call.subscribe(l),
  };
}

export function createPaymentProvider(bus: StubDeviceBus): PaymentContextProvider {
  return {
    source: 'DEMO',
    read: async () => bus.payment.value,
    subscribe: (l): Unsubscribe => bus.payment.subscribe(l),
  };
}

export function createNotificationProvider(bus: StubDeviceBus): NotificationContextProvider {
  return {
    source: 'DEMO',
    read: async () => bus.notification.value,
    subscribe: (l): Unsubscribe => bus.notification.subscribe(l),
  };
}

export function createConversationProvider(bus: StubDeviceBus): ConversationProvider {
  return {
    source: 'ON_DEVICE_HEURISTIC',
    start: async (_sessionId: string) => {
      await bus.startConversation();
    },
    stop: async () => {
      bus.stopConversation();
    },
    isRunning: () => bus.isRunning(),
    read: async () => bus.conversation.value,
    subscribe: (l): Unsubscribe => bus.conversation.subscribe(l),
  };
}

/* ------------------------------------------------------------------ *
 * Behaviour store — real statistics over a seeded local history
 * ------------------------------------------------------------------ */

export class StubBehaviourStore implements BehaviourStore {
  readonly source = 'LOCAL_STORE' as const;
  private transactions: TransactionRecord[] = [];
  private payeeOverride: Map<string, PayeeEvidence> = new Map();

  async seed(transactions: TransactionRecord[]): Promise<void> {
    this.transactions = [...transactions];
  }

  /** Convenience for the demo: seed from a list of rupee amounts. */
  async seedAmounts(amounts: number[], payeeHash = 'demo_history'): Promise<void> {
    const day = 24 * 60 * 60 * 1000;
    this.transactions = amounts.map((rupees, i) => ({
      id: newId('tx'),
      payeeHash,
      amountMinor: rupeesToMinor(rupees),
      timestamp: now() - (amounts.length - i) * day,
    }));
  }

  setPayee(payeeHash: string, evidence: PayeeEvidence): void {
    this.payeeOverride.set(payeeHash, evidence);
  }

  async listTransactions(limit = 20): Promise<TransactionRecord[]> {
    return [...this.transactions].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async recordTransaction(tx: TransactionRecord): Promise<void> {
    this.transactions.push(tx);
  }

  async getPayee(payeeHash: string | null): Promise<PayeeEvidence> {
    if (!payeeHash) {
      return {
        available: false,
        source: this.source,
        unavailableReason: 'The payment surface did not expose a recipient.',
        known: false,
        previousTransactions: 0,
        averageAmountMinor: null,
        maxAmountMinor: null,
        firstSeen: null,
        lastSeen: null,
        ageDays: null,
        userTrusted: false,
      };
    }

    const override = this.payeeOverride.get(payeeHash);
    if (override) {
      return override;
    }

    const matches = this.transactions.filter(t => t.payeeHash === payeeHash);
    if (matches.length === 0) {
      return {
        available: true,
        source: this.source,
        known: false,
        previousTransactions: 0,
        averageAmountMinor: null,
        maxAmountMinor: null,
        firstSeen: null,
        lastSeen: null,
        ageDays: null,
        userTrusted: false,
      };
    }

    const amounts = matches.map(m => m.amountMinor);
    const firstSeen = Math.min(...matches.map(m => m.timestamp));
    return {
      available: true,
      source: this.source,
      known: true,
      previousTransactions: matches.length,
      averageAmountMinor: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      maxAmountMinor: Math.max(...amounts),
      firstSeen,
      lastSeen: Math.max(...matches.map(m => m.timestamp)),
      ageDays: Math.round((now() - firstSeen) / (24 * 60 * 60 * 1000)),
      userTrusted: false,
    };
  }

  async getBehaviour(amountMinor: number | null): Promise<BehaviourEvidence> {
    const amounts = this.transactions.map(t => t.amountMinor).sort((a, b) => a - b);
    const sampleSize = amounts.length;
    const profileMature = sampleSize >= MIN_MATURE_SAMPLE;

    if (sampleSize === 0 || amountMinor === null) {
      return {
        available: sampleSize > 0,
        source: this.source,
        unavailableReason:
          sampleSize === 0 ? 'No payment history on this device yet.' : undefined,
        amountRatio: null,
        amountAnomaly: 0,
        medianAmountMinor: null,
        meanAmountMinor: null,
        p95AmountMinor: null,
        frequencyAnomaly: 0,
        timeAnomaly: 0,
        sampleSize,
        profileMature,
      };
    }

    const median = percentile(amounts, 0.5);
    const p95 = percentile(amounts, 0.95);
    const mean = Math.round(amounts.reduce((a, b) => a + b, 0) / sampleSize);
    const ratio = p95 > 0 ? amountMinor / p95 : null;

    return {
      available: true,
      source: this.source,
      amountRatio: ratio,
      amountAnomaly: normaliseAmountRatio(ratio),
      medianAmountMinor: median,
      meanAmountMinor: mean,
      p95AmountMinor: p95,
      frequencyAnomaly: this.frequencyAnomaly(),
      timeAnomaly: this.timeAnomaly(),
      sampleSize,
      profileMature,
    };
  }

  /** Payments in the last hour against this user's normal daily rate. */
  private frequencyAnomaly(): number {
    if (this.transactions.length < MIN_MATURE_SAMPLE) {
      return 0;
    }
    const hourAgo = now() - 60 * 60 * 1000;
    const recent = this.transactions.filter(t => t.timestamp >= hourAgo).length;
    const spanDays = Math.max(
      1,
      (now() - Math.min(...this.transactions.map(t => t.timestamp))) / (24 * 60 * 60 * 1000),
    );
    const perHour = this.transactions.length / (spanDays * 24);
    if (perHour <= 0) {
      return 0;
    }
    return clamp01((recent / perHour - 1) / 8);
  }

  /** How unusual this hour of day is for this user. */
  private timeAnomaly(): number {
    if (this.transactions.length < MIN_MATURE_SAMPLE) {
      return 0;
    }
    const hour = new Date().getHours();
    const hoursUsed = this.transactions.map(t => new Date(t.timestamp).getHours());
    const nearby = hoursUsed.filter(h => Math.abs(h - hour) <= 2).length;
    return clamp01(1 - nearby / Math.max(1, hoursUsed.length * 0.35));
  }
}

/**
 * Amount ratio -> [0,1] on a log curve: 2× is unremarkable, 8× is the top of
 * the scale. Linear normalisation would let a large-but-ordinary payment
 * dominate, which is the false positive that gets safety software switched off.
 */
export function normaliseAmountRatio(ratio: number | null): number {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 1) {
    return 0;
  }
  return clamp01(Math.log2(ratio) / Math.log2(8));
}

export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(p * sortedAscending.length) - 1),
  );
  return sortedAscending[idx]!;
}
