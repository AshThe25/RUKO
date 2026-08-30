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

/**
 * Android's backend names -> the contract's.
 *
 * The two vocabularies are not the same and never were. `ruko-core`'s enum is
 * `CPU, NNAPI, QUALCOMM, RULES, UNKNOWN` and the bridge sends it verbatim
 * (`putString("backend", runtime.backend.name)`), while the contract speaks of
 * `QNN` and `HEURISTIC`. Only the contract's spellings were accepted here, so a
 * device that genuinely initialised on the Qualcomm NPU reported `QUALCOMM` and
 * was translated to `UNAVAILABLE` -- as was the rules fallback. The Engineering
 * screen then said Ruko had no runtime at all on exactly the devices where it
 * had the best one.
 *
 * Erring toward `UNAVAILABLE` at least never claimed acceleration that was not
 * measured, which is why this went unnoticed. It is still a misreport, and the
 * honesty rule cuts both ways: the screen must say what the runtime returned.
 *
 * QUALCOMM and QNN are the same thing (the Qualcomm Neural Network SDK), and
 * RULES is the deterministic lexical path the contract calls HEURISTIC. Both
 * spellings are accepted so the mapping keeps working whichever layer changes
 * name first.
 */
export function toInferenceBackend(nativeBackend: string | null | undefined): InferenceBackend {
  switch (nativeBackend) {
    case 'CPU':
    case 'NNAPI':
    case 'QNN':
    case 'XNNPACK':
    case 'HEURISTIC':
      return nativeBackend;
    case 'QUALCOMM':
      return 'QNN';
    case 'RULES':
      return 'HEURISTIC';
    // 'UNKNOWN' is ruko-core's way of saying it could not establish one, which
    // is what UNAVAILABLE means here. Handled by the default, and named so the
    // correspondence is not rediscovered later.
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

/* ------------------------------------------------------------------ *
 * The payment currently under investigation
 * ------------------------------------------------------------------ */

/**
 * The payment that triggered the investigation now running.
 *
 * The accessibility reading is deliberately short-lived: it goes stale after
 * 15s and is dropped when the user leaves the payment app, because acting on a
 * payment someone already abandoned would be worse than not acting. That is
 * right for *deciding whether to interrupt*, and wrong for *the investigation
 * already under way* — which outlives the reading, especially once a guardian
 * round-trip is involved.
 *
 * So the evidence that arrived with `ruko:onPaymentDetected` is held for the
 * duration of the investigation it started. This is not a fabricated reading:
 * it is the reading the accessibility service actually took, at the confidence
 * it actually reported, kept rather than discarded. Nothing is invented here —
 * `latchDetectedPayment` only ever stores what native measured.
 */
let latchedPayment: PaymentEvidence | null = null;

/**
 * A latch that is never released would make a finished payment look live to
 * the next investigation, so it also expires on its own. Generous, because an
 * investigation plus a 45s guardian escalation is legitimately slow; short
 * enough that a leaked latch cannot survive into an unrelated payment.
 */
const LATCH_MAX_AGE_MS = 5 * 60_000;

/** Hold the payment that triggered an investigation, for its duration. */
export function latchDetectedPayment(payment: DetectedPayment): void {
  latchedPayment = {
    available: true,
    source: 'ACCESSIBILITY',
    active: true,
    amountMinor: payment.amountMinor,
    currency: 'INR',
    payeeDisplayName: payment.payeeDisplayName,
    payeeHash: payment.payeeHash,
    appPackage: payment.appPackage,
    timestamp: payment.timestamp,
  };
}

/** The investigation is over: the payment is no longer the live one. */
export function releaseDetectedPayment(): void {
  latchedPayment = null;
}

/** Exposed for tests; callers should use the provider. */
export function currentLatchedPayment(nowMs: number = now()): PaymentEvidence | null {
  if (!latchedPayment) return null;
  if (nowMs - latchedPayment.timestamp > LATCH_MAX_AGE_MS) {
    latchedPayment = null;
    return null;
  }
  return latchedPayment;
}

export function createNativePaymentProvider(): PaymentContextProvider {
  const native = getNativeModule();
  return pollingProvider<NativePaymentContext, PaymentEvidence>(
    'ACCESSIBILITY',
    toPaymentEvidence(null),
    () => safeNative(() => native?.getPaymentContext()),
    // The latched payment wins while one is held. The native reading is the
    // same payment when it is still on screen and null once it is not, so
    // preferring the latch costs nothing and is what keeps the evidence alive
    // across the app switch into Ruko's own UI.
    raw => currentLatchedPayment() ?? toPaymentEvidence(raw),
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
  /**
   * Turns one utterance into text. Supplied by the caller so this file stays
   * free of network concerns and can be tested without one. Absent means the
   * device has no way to transcribe, and segments are counted, not read.
   */
  transcribe?: (wavBase64: string) => Promise<string>,
  /**
   * Recent scam-message text, already redacted native-side.
   *
   * WHY THIS EXISTS. The manipulation model reads *language*, and a KYC scam
   * run over chat uses the same coercion, authority and urgency it uses on a
   * call. But the classifier was only ever fed ASR output, so with no call in
   * progress the model sat idle through the exact attack it was trained for:
   * the notification family contributed its 3-point ceiling, no conversation
   * evidence existed at all, and a textbook scam scored in single figures.
   *
   * So when nothing was heard, the same model reads the messages instead. The
   * evidence is marked `textSource: 'MESSAGES'` and the UI says so -- Ruko
   * never claims to have heard something it read.
   */
  readMessageText?: () => Promise<string[]>,
  /**
   * Notified with the growing transcript each time a segment is transcribed,
   * so the pay screen can show the live words. Display-only: it can never
   * change a score.
   */
  onTranscript?: (lines: string[]) => void,
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
          // Prefer a local transcript. Otherwise transcribe the audio, which
          // is only present when the user has switched that on.
          let text = segment?.transcript ?? '';
          if (!text && segment?.audioWavBase64 && transcribe) {
            try {
              text = await transcribe(segment.audioWavBase64);
            } catch {
              // A transcription failure degrades the quality of a check. It
              // must never interrupt protection already running on the device.
              text = '';
            }
          }
          if (!text) {
            emitter.emit(noTranscript('listening', segmentsHeard));
            return;
          }
          transcript.push(text);
          // Sliding window: the recent conversation, not the whole call.
          if (transcript.length > 24) {
            transcript = transcript.slice(-24);
          }
          onTranscript?.([...transcript]);
          emitter.emit(await classify(transcript.join(' ')));
        },
      );

      // Let audio cross the bridge only when there is somewhere for it to go.
      // The native side withholds the PCM unless this is switched on, and
      // nothing was switching it on — so `audioWavBase64` was never present,
      // `transcribe` was never reached, and every session reported "nothing
      // was heard" while the microphone and the VAD were working perfectly.
      //
      // Tying it to `transcribe` rather than to a flag keeps the promise the
      // native comment makes: with no transcriber configured this stays false
      // and the audio never leaves the device, which is still the default.
      await safeNative(() => native?.setShareAudioWithJs(Boolean(transcribe)));

      await safeNative(() => native?.startProtection());
    },
    async stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      transcript = [];
      // Revoke on the way out, so a stopped session cannot leave the bridge
      // open for the next one.
      await safeNative(() => native?.setShareAudioWithJs(false));
      await safeNative(() => native?.stopProtection());
      // Derived evidence dies with the session. Nothing is retained.
      emitter.emit(noTranscript('idle'));
    },
    isRunning: () => running,
    read: async () => {
      // Speech, whenever there is any: a live call is richer evidence than a
      // handful of message excerpts, and it is what the reliability score was
      // calibrated on.
      if (emitter.value.available) return emitter.value;
      const evidence = await classifyMessages(classify, readMessageText);
      if (evidence) emitter.emit(evidence);
      return emitter.value;
    },
    subscribe: (l): Unsubscribe => emitter.subscribe(l),
  };
}

/**
 * Run the manipulation model over recent message text.
 *
 * Returns null -- leaving the evidence honestly unavailable -- whenever there
 * is no text to read or the model cannot produce a result. An empty score set
 * would be read by the risk engine as "measured, and nothing concerning was
 * said", which is a very different and much more dangerous claim.
 */
async function classifyMessages(
  classify: (transcript: string) => Promise<ConversationEvidence>,
  readMessageText?: () => Promise<string[]>,
): Promise<ConversationEvidence | null> {
  if (!readMessageText) return null;
  let messages: string[] = [];
  try {
    messages = await readMessageText();
  } catch {
    return null;
  }
  const text = messages.map(m => m.trim()).filter(Boolean).join('. ');
  if (!text) return null;

  try {
    const evidence = await classify(text);
    if (!evidence.available) return null;
    return {
      ...evidence,
      textSource: 'MESSAGES',
      // The window is a count of messages, not a duration -- nothing was
      // spoken, so claiming milliseconds of speech would be a fabrication.
      windowMs: 0,
      transcriptChars: text.length,
    };
  } catch {
    return null;
  }
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

/**
 * Seed a payment through the native demo provider, which sits in the same
 * chain the accessibility reader does. A no-op without the native module, so
 * a stub build keeps working unchanged.
 */
export async function openNativeDemoPayment(
  amountMinor: number,
  payee: string,
  payeeId: string,
): Promise<void> {
  const native = getNativeModule();
  if (!native?.beginDemoPayment) return;
  await safeNative(() => native.beginDemoPayment(amountMinor, payee, payeeId));
}

/** What the accessibility service saw when a payment appeared on screen. */
export interface DetectedPayment {
  amountMinor: number;
  payeeDisplayName: string;
  payeeHash: string;
  appPackage: string;
  timestamp: number;
}

/**
 * Draw Ruko's interruption on top of the payment app.
 *
 * Returns false when the overlay could not be shown — almost always because
 * "Display over other apps" was never granted. The caller must treat that as
 * "the user was not warned", never as a silent success: the whole product
 * claim is that something appears before the money moves.
 */
export async function showNativeIntervention(args: {
  headline: string;
  reason: string;
  amountLabel: string;
  payee: string;
  requiresGuardian: boolean;
}): Promise<boolean> {
  const native = getNativeModule();
  if (!native?.showIntervention) return false;
  const shown = await safeNative(() =>
    native.showIntervention(
      args.headline,
      args.reason,
      args.amountLabel,
      args.payee,
      args.requiresGuardian,
    ),
  );
  return shown === true;
}

export async function hideNativeIntervention(): Promise<void> {
  const native = getNativeModule();
  if (!native?.hideIntervention) return;
  await safeNative(() => native.hideIntervention());
}

/**
 * Begin watching for payment screens.
 *
 * Returns the reason it could not start, or null on success. Callers must
 * surface a failure: a Ruko that silently is not watching looks exactly like a
 * Ruko that is.
 */
export async function startPaymentWatch(): Promise<string | null> {
  const native = getNativeModule();
  if (!native?.startPaymentWatch) {
    return 'This build has no native module, so payment screens cannot be read.';
  }
  try {
    const connected = await native.startPaymentWatch();
    // The wiring is in place either way; this reports whether the device is
    // actually delivering screen events yet.
    return connected
      ? null
      : 'Ruko is not watching payment screens yet — turn on its accessibility service in Settings.';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
