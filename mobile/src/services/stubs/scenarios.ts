/**
 * Demo scenarios.
 *
 * These are scripted *inputs*, never scripted outputs. Each scenario supplies
 * a transcript, a payment, a caller and a seeded payment history; the real
 * classifier, the real agent and the real risk engine then do their work. If
 * you edit a line of dialogue here, the score on screen moves. That is the
 * point — Demo Mode has to be able to fail.
 *
 * `expectation` is shown only in the demo picker, so an operator can see when
 * the pipeline disagrees with what we expected. It never becomes a result.
 */
import type {InvestigationTrigger} from '@contracts';
import {rupeesToMinor} from '@/utils/format';

export type ScenarioId =
  | 'live-voice'
  | 'bank-impersonation'
  | 'friend-dinner'
  | 'landlord-rent';

export interface ScenarioLine {
  atMs: number;
  speaker: 'CALLER' | 'FRIEND' | 'USER';
  text: string;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  caption: string;
  trigger: InvestigationTrigger;
  lines: ScenarioLine[];
  /**
   * When true this scenario has no scripted dialogue: the microphone is opened
   * on the payment screen and the operator speaks, transcribed live by Sarvam
   * through Ruko's proxy and scored on device. This is the "prove it on real
   * voice" path.
   */
  liveMic?: boolean;
  call: {
    active: boolean;
    callerKnown: boolean | null;
    direction: 'INCOMING' | 'OUTGOING' | 'UNKNOWN';
    startedBeforePayment: boolean | null;
  };
  payment: {
    amountMinor: number;
    payeeDisplayName: string;
    payeeHash: string;
    appPackage: string;
  };
  payee: {
    known: boolean;
    previousTransactions: number;
    averageAmountMinor: number | null;
    userTrusted: boolean;
    ageDays: number | null;
  };
  notification: {suspicion: number; matchedCategories: string[]; count: number} | null;
  /** Seeded payment history in rupees, oldest first. */
  history: number[];
  expectation: string;
}

const EVERYDAY_HISTORY = [320, 450, 180, 1200, 800, 2100, 650, 900, 1500, 240, 1100, 380];

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  'live-voice': {
    id: 'live-voice',
    title: 'Live voice — speak yourself',
    caption: 'You talk; Ruko transcribes with Sarvam and scores it on device',
    trigger: 'PAYMENT_SCREEN_DETECTED',
    lines: [],
    liveMic: true,
    call: {active: false, callerKnown: null, direction: 'UNKNOWN', startedBeforePayment: null},
    payment: {
      amountMinor: rupeesToMinor(48000),
      payeeDisplayName: 'Ravi Verify',
      payeeHash: 'demo_live_ravi',
      appPackage: 'com.ruko.paydemo',
    },
    payee: {
      known: false,
      previousTransactions: 0,
      averageAmountMinor: null,
      userTrusted: false,
      ageDays: null,
    },
    notification: null,
    history: EVERYDAY_HISTORY,
    expectation: 'Depends on what you say — the conversation is real.',
  },

  'bank-impersonation': {
    id: 'bank-impersonation',
    title: 'Bank impersonation',
    caption: 'Authority + coercion + urgency, new payee, 20× the usual amount',
    trigger: 'CALL_DURING_PAYMENT',
    lines: [
      {atMs: 0, speaker: 'CALLER', text: 'Hello sir, I am calling from your bank, security team.'},
      {atMs: 2600, speaker: 'CALLER', text: 'There has been suspicious activity on your account.'},
      {atMs: 5200, speaker: 'CALLER', text: 'Your account will be frozen within ten minutes if we do not act.'},
      {atMs: 8000, speaker: 'USER', text: 'What do I need to do?'},
      {atMs: 9200, speaker: 'CALLER', text: 'You must transfer 48000 immediately to the verification account I am sending.'},
      {atMs: 12000, speaker: 'CALLER', text: 'Do not disconnect this call, and do not discuss this with anyone.'},
    ],
    call: {active: true, callerKnown: false, direction: 'INCOMING', startedBeforePayment: true},
    payment: {
      amountMinor: rupeesToMinor(48000),
      payeeDisplayName: 'Ravi Verify',
      payeeHash: 'demo_ravi_verify',
      appPackage: 'com.ruko.paydemo',
    },
    payee: {
      known: false,
      previousTransactions: 0,
      averageAmountMinor: null,
      userTrusted: false,
      ageDays: null,
    },
    notification: {
      suspicion: 0.61,
      matchedCategories: ['ACCOUNT_FREEZE', 'KYC_EXPIRY'],
      count: 2,
    },
    history: EVERYDAY_HISTORY,
    expectation: 'CRITICAL — intervention, guardian escalation',
  },

  'friend-dinner': {
    id: 'friend-dinner',
    title: 'Friend asking for dinner money',
    caption: 'Money is mentioned, but no pressure and a known recipient',
    trigger: 'PAYMENT_SCREEN_DETECTED',
    lines: [
      {atMs: 0, speaker: 'FRIEND', text: 'Hey, can you send 500 for dinner whenever you get a chance?'},
      {atMs: 3000, speaker: 'USER', text: 'Yeah sending now.'},
      {atMs: 4500, speaker: 'FRIEND', text: 'No rush at all, thanks!'},
    ],
    call: {active: true, callerKnown: true, direction: 'OUTGOING', startedBeforePayment: false},
    payment: {
      amountMinor: rupeesToMinor(500),
      payeeDisplayName: 'Ananya',
      payeeHash: 'demo_ananya',
      appPackage: 'com.ruko.paydemo',
    },
    payee: {
      known: true,
      previousTransactions: 14,
      averageAmountMinor: rupeesToMinor(640),
      userTrusted: false,
      ageDays: 420,
    },
    notification: null,
    history: EVERYDAY_HISTORY,
    expectation: 'LOW — no interruption. Proves Ruko does not flag every payment conversation.',
  },

  'landlord-rent': {
    id: 'landlord-rent',
    title: 'Rent to the landlord',
    caption: 'A large payment that is completely normal for this user',
    trigger: 'PAYMENT_SCREEN_DETECTED',
    lines: [],
    call: {active: false, callerKnown: null, direction: 'UNKNOWN', startedBeforePayment: null},
    payment: {
      amountMinor: rupeesToMinor(50000),
      payeeDisplayName: 'S. Prakash (landlord)',
      payeeHash: 'demo_landlord',
      appPackage: 'com.ruko.paydemo',
    },
    payee: {
      known: true,
      previousTransactions: 9,
      averageAmountMinor: rupeesToMinor(50000),
      userTrusted: true,
      ageDays: 280,
    },
    notification: null,
    history: [...EVERYDAY_HISTORY, 50000, 50000, 50000, 50000],
    expectation: 'LOW — a big payment is not a suspicious payment. This is the false-positive test.',
  },
};

export const SCENARIO_ORDER: ScenarioId[] = [
  'live-voice',
  'bank-impersonation',
  'friend-dinner',
  'landlord-rent',
];
