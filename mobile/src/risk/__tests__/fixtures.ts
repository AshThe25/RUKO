/**
 * Test fixtures for the risk layer.
 *
 * Every fixture defaults to "nothing is known" rather than "nothing is
 * happening", so a test that forgets to set a field gets an honest unavailable
 * state instead of a silently benign zero.
 */

import type {
  CallEvidence,
  ConversationEvidence,
  ManipulationScores,
  NotificationEvidence,
  PaymentEvidence,
  RiskEvidence,
} from '../../contracts/index.ts';
import type { BehaviourEvidence, PayeeEvidence } from '../../contracts/index.ts';

export const NOW = Date.UTC(2026, 7, 29, 14, 30, 0);

const ZERO_SCORES: ManipulationScores = {
  authority: 0, coercion: 0, urgency: 0,
  financialInstruction: 0, secrecy: 0, credentialRequest: 0,
};

export function conversation(
  scores: Partial<ManipulationScores> = {},
  over: Partial<ConversationEvidence> = {},
): ConversationEvidence {
  return {
    available: true,
    source: 'ON_DEVICE_MODEL',
    scores: { ...ZERO_SCORES, ...scores },
    reliability: 1,
    windowMs: 8000,
    transcriptChars: 180,
    modelVersion: 'test-model',
    backend: 'CPU',
    detectedLanguage: 'en',
    timestamp: NOW,
    ...over,
  };
}

export const noConversation = (): ConversationEvidence => ({
  ...conversation(),
  available: false,
  source: 'ON_DEVICE_MODEL',
  unavailableReason: 'microphone permission not granted',
});

export function payment(over: Partial<PaymentEvidence> = {}): PaymentEvidence {
  return {
    available: true,
    source: 'DEMO',
    active: true,
    amountMinor: 5_000_00,
    currency: 'INR',
    payeeDisplayName: 'Test Payee',
    payeeHash: 'payee-test',
    timestamp: NOW,
    ...over,
  };
}

export function payee(over: Partial<PayeeEvidence> = {}): PayeeEvidence {
  return {
    available: true,
    source: 'LOCAL_STORE',
    known: false,
    previousTransactions: 0,
    averageAmountMinor: null,
    maxAmountMinor: null,
    firstSeen: null,
    lastSeen: null,
    ageDays: null,
    userTrusted: false,
    ...over,
  };
}

export function behaviour(over: Partial<BehaviourEvidence> = {}): BehaviourEvidence {
  return {
    available: true,
    source: 'LOCAL_STORE',
    amountRatio: 1,
    amountAnomaly: 0,
    medianAmountMinor: 80_000,
    meanAmountMinor: 90_000,
    p95AmountMinor: 200_000,
    frequencyAnomaly: 0,
    timeAnomaly: 0,
    sampleSize: 24,
    profileMature: true,
    ...over,
  };
}

export function call(over: Partial<CallEvidence> = {}): CallEvidence {
  return {
    available: true,
    source: 'ANDROID_API',
    active: false,
    callerKnown: null,
    direction: 'UNKNOWN',
    durationMs: null,
    startedBeforePayment: null,
    ...over,
  };
}

export function notification(over: Partial<NotificationEvidence> = {}): NotificationEvidence {
  return {
    available: true,
    source: 'ANDROID_API',
    suspicion: 0,
    matchedCategories: [],
    count: 0,
    windowMs: 600_000,
    ...over,
  };
}

export function evidence(over: Partial<RiskEvidence> = {}): RiskEvidence {
  return {
    sessionId: 'test-session',
    timestamp: NOW,
    conversation: conversation(),
    payment: payment(),
    payee: payee(),
    behaviour: behaviour(),
    call: call(),
    ...over,
  };
}
