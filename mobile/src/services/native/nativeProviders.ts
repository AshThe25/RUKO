/**
 * Adapters that turn the native module's payloads into contract evidence.
 *
 * Everything the native side sends is treated as untrusted: a missing field
 * becomes `available: false` with a reason, never a zero. On a device where the
 * accessibility service cannot read the payment screen, Ruko has to say "I
 * could not read this", because "amount 0, no payee" would score as a
 * perfectly safe payment.
 */
import type {
  CallContextProvider,
  CallEvidence,
  ConversationEvidence,
  ConversationProvider,
  LocalRiskClassifier,
  NotificationContextProvider,
  NotificationEvidence,
  PaymentContextProvider,
  PaymentEvidence,
  Unsubscribe,
} from '@contracts';
import {clamp01} from '@contracts';
import {now} from '@/utils/id';
import {Emitter} from '../stubs/emitter';
import {
  getNativeModule,
  onNativeEvent,
  type NativeCallState,
  type NativeNotificationContext,
  type NativePaymentContext,
  type NativeSpeechChunk,
} from './RukoNative';

const UNAVAILABLE = (reason: string) => ({available: false as const, unavailableReason: reason});

export function toCallEvidence(raw: NativeCallState | null): CallEvidence {
  if (!raw) {
    return {
      ...UNAVAILABLE('Ruko could not read the call state on this device.'),
      source: 'ANDROID_API',
      active: false,
      callerKnown: null,
      direction: 'UNKNOWN',
      durationMs: null,
      startedBeforePayment: null,
    };
  }
  return {
    available: true,
    source: 'ANDROID_API',
    active: !!raw.active,
    callerKnown: typeof raw.callerKnown === 'boolean' ? raw.callerKnown : null,
    direction: raw.direction ?? 'UNKNOWN',
    durationMs: numberOrNull(raw.durationMs),
    startedBeforePayment:
      typeof raw.startedBeforePayment === 'boolean' ? raw.startedBeforePayment : null,
  };
}

export function toPaymentEvidence(raw: NativePaymentContext | null): PaymentEvidence {
  if (!raw) {
    return {
      ...UNAVAILABLE('No payment surface has been detected.'),
      source: 'ACCESSIBILITY',
      active: false,
      amountMinor: null,
      currency: 'INR',
      payeeDisplayName: null,
      payeeHash: null,
      timestamp: now(),
    };
  }
  const amountMinor = numberOrNull(raw.amountMinor);
  const unreadable = raw.active && amountMinor === null;
  return {
    // An active payment screen we could not parse is *not* a safe payment.
    ...(unreadable
      ? UNAVAILABLE('Ruko could see a payment screen but could not read the amount.')
      : {available: true as const}),
    source: raw.parsed === 'DEMO' ? 'DEMO' : 'ACCESSIBILITY',
    active: !!raw.active,
    amountMinor,
    currency: 'INR',
    payeeDisplayName: raw.payeeDisplayName ?? null,
    payeeHash: raw.payeeHash ?? null,
    ...(raw.appPackage ? {appPackage: raw.appPackage} : {}),
    timestamp: now(),
  };
}

export function toNotificationEvidence(raw: NativeNotificationContext | null): NotificationEvidence {
  if (!raw) {
    return {
      ...UNAVAILABLE('Notification access has not been granted.'),
      source: 'ANDROID_API',
      suspicion: 0,
      matchedCategories: [],
      count: 0,
      windowMs: 0,
    };
  }
  return {
    available: true,
    source: 'ANDROID_API',
    suspicion: clamp01(raw.suspicion ?? 0),
    matchedCategories: Array.isArray(raw.matchedCategories) ? raw.matchedCategories : [],
    count: Math.max(0, Math.floor(raw.count ?? 0)),
    windowMs: Math.max(0, raw.windowMs ?? 0),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

export function createNativeCallProvider(): CallContextProvider {
  const native = getNativeModule();
  const emitter = new Emitter<CallEvidence>(toCallEvidence(null));
  onNativeEvent<NativeCallState>('onCallStateChanged', raw => emitter.emit(toCallEvidence(raw)));
  return {
    source: 'ANDROID_API',
    read: async () => toCallEvidence(await safe(() => native?.getCallState())),
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

export function createNativePaymentProvider(): PaymentContextProvider {
  const native = getNativeModule();
  const emitter = new Emitter<PaymentEvidence>(toPaymentEvidence(null));
  onNativeEvent<NativePaymentContext>('onPaymentContext', raw =>
    emitter.emit(toPaymentEvidence(raw)),
  );
  return {
    source: 'ACCESSIBILITY',
    read: async () => toPaymentEvidence(await safe(() => native?.getPaymentContext())),
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

export function createNativeNotificationProvider(): NotificationContextProvider {
  const native = getNativeModule();
  const emitter = new Emitter<NotificationEvidence>(toNotificationEvidence(null));
  onNativeEvent<NativeNotificationContext>('onNotificationContext', raw =>
    emitter.emit(toNotificationEvidence(raw)),
  );
  return {
    source: 'ANDROID_API',
    read: async () => toNotificationEvidence(await safe(() => native?.getNotificationContext())),
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

/**
 * Speech from the device, classified on the device.
 *
 * The native side sends transcript windows; the classifier turns them into
 * evidence. Which classifier that is — the ONNX model or the deterministic
 * fallback — is decided by whatever `LocalRiskClassifier` is passed in, and
 * that choice is reported to the engineering screen, not assumed here.
 */
export function createNativeConversationProvider(
  classifier: LocalRiskClassifier,
): ConversationProvider {
  const native = getNativeModule();
  const emitter = new Emitter<ConversationEvidence>(emptyConversation());
  let running = false;
  let transcript: string[] = [];
  let unsubscribe: (() => void) | null = null;

  return {
    source: 'ON_DEVICE_MODEL',
    async start(sessionId: string) {
      if (running) {
        return;
      }
      transcript = [];
      running = true;
      unsubscribe = onNativeEvent<NativeSpeechChunk>('onSpeechChunk', async chunk => {
        if (!chunk?.text) {
          return;
        }
        transcript.push(chunk.text);
        // Sliding window: keep the recent conversation, not the whole call.
        if (transcript.length > 24) {
          transcript = transcript.slice(-24);
        }
        emitter.emit(await classifier.classify(transcript.join(' ')));
      });
      await native?.startAudioSession(sessionId);
    },
    async stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      transcript = [];
      await safe(() => native?.stopAudioSession());
      // Derived evidence is dropped with the session; nothing is retained.
      emitter.emit(emptyConversation());
    },
    isRunning: () => running,
    read: async () => emitter.value,
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

function emptyConversation(): ConversationEvidence {
  return {
    available: false,
    source: 'ON_DEVICE_MODEL',
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
    modelVersion: 'none',
    backend: 'UNAVAILABLE',
    detectedLanguage: 'unknown',
    timestamp: now(),
  };
}

/** Native calls can reject; a rejection means "unknown", never "fine". */
async function safe<T>(fn: () => Promise<T> | undefined): Promise<T | null> {
  try {
    const value = await fn();
    return value ?? null;
  } catch {
    return null;
  }
}
