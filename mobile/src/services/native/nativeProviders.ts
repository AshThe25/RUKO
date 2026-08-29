/**
 * Adapters between the native module and the shared contracts.
 *
 * Two jobs. First, unit and name conversion — Android sends rupees, seconds and
 * its own field names; the contracts are paise, milliseconds and theirs.
 * Second, and more important: everything from native is treated as untrusted.
 * A missing or unparseable field becomes `available: false` with a reason,
 * never a zero. On a device where the accessibility service can see a payment
 * screen but not read it, Ruko has to say "I could not read this" — because
 * "amount 0, no payee" would score as a perfectly safe payment.
 */
import type {
  CallContextProvider,
  CallEvidence,
  ConversationEvidence,
  ConversationProvider,
  EvidenceSource,
  InferenceBackend,
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
  NATIVE_EVENTS,
  getNativeModule,
  onNativeEvent,
  safeNative,
  type NativeAiBackend,
  type NativeCallContext,
  type NativeNotificationContext,
  type NativePaymentContext,
  type NativeSpeechSegment,
} from './RukoNative';

const unavailable = (reason: string) => ({
  available: false as const,
  unavailableReason: reason,
});

/** Android's PaymentContextSource -> the contract's EvidenceSource. */
export function toEvidenceSource(nativeSource: string | null | undefined): EvidenceSource {
  switch (nativeSource) {
    case 'ACCESSIBILITY':
      return 'ACCESSIBILITY';
    case 'DEMO':
      return 'DEMO';
    default:
      return 'MOCK';
  }
}

export function toInferenceBackend(nativeBackend: string | null | undefined): InferenceBackend {
  switch (nativeBackend) {
    case 'CPU':
    case 'NNAPI':
    case 'QNN':
    case 'XNNPACK':
    case 'HEURISTIC':
      return nativeBackend;
    default:
      return 'UNAVAILABLE';
  }
}

/* ------------------------------------------------------------------ *
 * Payload -> evidence
 * ------------------------------------------------------------------ */

export function toPaymentEvidence(raw: NativePaymentContext | null): PaymentEvidence {
  if (!raw) {
    return {
      ...unavailable('No payment surface has been detected.'),
      source: 'ACCESSIBILITY',
      active: false,
      amountMinor: null,
      currency: 'INR',
      payeeDisplayName: null,
      payeeHash: null,
      timestamp: now(),
    };
  }

  // The bridge already sends integer paise as `amountMinor` (RukoNativeModule
  // putDouble("amountMinor", ...)). This previously read a field named `amount`
  // that the bridge never sends and multiplied it by 100 -- so it was undefined
  // on every real payment, every amount came back null, and each one was
  // treated as an unreadable screen. Read the field that exists, and do not
  // scale a value that is already in the contract's unit.
  const amountMinor =
    typeof raw.amountMinor === 'number' && Number.isFinite(raw.amountMinor) && raw.amountMinor > 0
      ? Math.round(raw.amountMinor)
      : null;

  // An active payment screen we could not read is not a safe payment.
  const unreadable = raw.active && amountMinor === null;

  return {
    ...(unreadable
      ? unavailable('Ruko could see a payment screen but could not read the amount.')
      : {available: true as const}),
    source: toEvidenceSource(raw.source),
    active: !!raw.active,
    amountMinor,
    currency: 'INR',
    payeeDisplayName: raw.payee ?? null,
    payeeHash: raw.payeeHash ?? null,
    ...(raw.packageName ? {appPackage: raw.packageName} : {}),
    timestamp: parseTimestamp(raw.observedAt),
  };
}

export function toCallEvidence(raw: NativeCallContext | null): CallEvidence {
  if (!raw) {
    return {
      ...unavailable('Ruko could not read the call state on this device.'),
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
    // The bridge sends a non-null boolean, so "we could not check contacts"
    // cannot currently be expressed. See INTEGRATION.md §9.
    callerKnown: typeof raw.callerKnown === 'boolean' ? raw.callerKnown : null,
    // The bridge does not report direction yet.
    direction: 'UNKNOWN',
    durationMs:
      typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)
        ? Math.round(raw.durationSeconds * 1000)
        : null,
    startedBeforePayment: null,
  };
}

export function toNotificationEvidence(
  raw: NativeNotificationContext | null,
): NotificationEvidence {
  if (!raw) {
    return {
      ...unavailable('Notification access has not been granted.'),
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
    // The bridge reports a count, not which categories matched.
    matchedCategories: [],
    count: Math.max(0, Math.floor(raw.matchCount ?? 0)),
    windowMs: Math.max(0, Math.round((raw.lookbackMinutes ?? 0) * 60_000)),
  };
}

export function describeBackend(raw: NativeAiBackend | null): {
  backend: InferenceBackend;
  model: string | null;
  ready: boolean;
  local: boolean;
  lastLatencyMs: number | null;
  degradedReason: string | null;
} {
  if (!raw) {
    return {
      backend: 'UNAVAILABLE',
      model: null,
      ready: false,
      local: false,
      lastLatencyMs: null,
      degradedReason: 'The native AI runtime did not answer.',
    };
  }
  return {
    backend: toInferenceBackend(raw.backend),
    model: raw.model || null,
    ready: !!raw.isReady,
    local: !!raw.isLocal,
    lastLatencyMs: typeof raw.lastLatencyMs === 'number' ? raw.lastLatencyMs : null,
    degradedReason: raw.degradedReason ?? null,
  };
}

/**
 * The bridge sends epoch milliseconds as a number. Date.parse of a number is
 * NaN, so this used to fall through to `now()` for every real payment -- a
 * stale reading was indistinguishable from a fresh one, which matters when the
 * window a payment falls in decides whether it is anomalous. Strings are still
 * accepted so a mocked provider can hand over an ISO date.
 */
function parseTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : now();
  }
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? now() : parsed;
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

/**
 * The bridge emits a call-state change and a protection-state change, but not
 * a fresh payment or notification payload. So every event is a cue to re-read,
 * which keeps one code path for both the push and the pull case.
 */
function pollingProvider<T, E>(
  source: EvidenceSource,
  initial: E,
  read: () => Promise<T | null>,
  map: (raw: T | null) => E,
  events: ReadonlyArray<string>,
) {
  const emitter = new Emitter<E>(initial);
  const refresh = async () => emitter.emit(map(await read()));
  // A refresh that fails leaves the last known value in place; the next event
  // or read will correct it.
  events.forEach(event => onNativeEvent(event as never, () => refresh().catch(() => {})));
  return {
    source,
    read: async (): Promise<E> => {
      const value = map(await read());
      emitter.emit(value);
      return value;
    },
    subscribe: (l: (value: E) => void): Unsubscribe => emitter.subscribe(l),
  };
}

export function createNativeCallProvider(): CallContextProvider {
  const native = getNativeModule();
  return pollingProvider<NativeCallContext, CallEvidence>(
    'ANDROID_API',
    toCallEvidence(null),
    () => safeNative(() => native?.getCallContext()),
    toCallEvidence,
    [NATIVE_EVENTS.callStateChanged, NATIVE_EVENTS.protectionState],
  );
}

export function createNativePaymentProvider(): PaymentContextProvider {
  const native = getNativeModule();
  return pollingProvider<NativePaymentContext, PaymentEvidence>(
    'ACCESSIBILITY',
    toPaymentEvidence(null),
    () => safeNative(() => native?.getPaymentContext()),
    toPaymentEvidence,
    [NATIVE_EVENTS.protectionState],
  );
}

export function createNativeNotificationProvider(): NotificationContextProvider {
  const native = getNativeModule();
  return pollingProvider<NativeNotificationContext, NotificationEvidence>(
    'ANDROID_API',
    toNotificationEvidence(null),
    () => safeNative(() => native?.getNotificationContext()),
    toNotificationEvidence,
    [NATIVE_EVENTS.protectionState],
  );
}

/**
 * Speech from the device.
 *
 * The audio itself deliberately never crosses the bridge — `onSpeechSegment`
 * carries the *shape* of an utterance (duration, sample count), not its
 * contents. Which means that until the native layer runs ASR and sends a
 * transcript, or the classifier moves native, there is nothing here for a JS
 * classifier to read.
 *
 * Rather than quietly returning empty scores — which the risk engine would
 * read as "measured, and nothing concerning was said" — this provider reports
 * the evidence as *unavailable*, with the reason, and tracks whether speech is
 * being heard at all so the UI can honestly show "listening". The engine then
 * degrades, and the user is told the conversation was not assessed.
 *
 * The day `transcript` appears on the segment, delete the branch below.
 */
export function createNativeConversationProvider(
  classify: (transcript: string) => Promise<ConversationEvidence>,
): ConversationProvider {
  const native = getNativeModule();
  const emitter = new Emitter<ConversationEvidence>(noTranscript('idle'));
  let running = false;
  let transcript: string[] = [];
  let unsubscribe: (() => void) | null = null;
  let segmentsHeard = 0;

  return {
    source: 'ON_DEVICE_MODEL',
    async start(_sessionId: string) {
      if (running) {
        return;
      }
      running = true;
      transcript = [];
      segmentsHeard = 0;

      unsubscribe = onNativeEvent<NativeSpeechSegment>(
        NATIVE_EVENTS.speechSegment,
        async segment => {
          segmentsHeard += 1;
          if (!segment?.transcript) {
            emitter.emit(noTranscript('listening', segmentsHeard));
            return;
          }
          transcript.push(segment.transcript);
          // Sliding window: the recent conversation, not the whole call.
          if (transcript.length > 24) {
            transcript = transcript.slice(-24);
          }
          emitter.emit(await classify(transcript.join(' ')));
        },
      );

      await safeNative(() => native?.startProtection());
    },
    async stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      transcript = [];
      await safeNative(() => native?.stopProtection());
      // Derived evidence dies with the session. Nothing is retained.
      emitter.emit(noTranscript('idle'));
    },
    isRunning: () => running,
    read: async () => emitter.value,
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

function noTranscript(phase: 'idle' | 'listening', segments = 0): ConversationEvidence {
  return {
    available: false,
    source: 'ON_DEVICE_MODEL',
    unavailableReason:
      phase === 'listening'
        ? `Ruko heard ${segments} segment${segments === 1 ? '' : 's'} of speech, but the device is not producing a transcript it can analyse.`
        : 'No speech has been analysed in this session yet.',
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
