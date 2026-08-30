/**
 * Typed access to the native Ruko module.
 *
 * The shapes here mirror `android/ruko-native/.../bridge/RukoNativeModule.kt`
 * exactly — method names, field names and units. Where they disagree with the
 * contracts (rupees vs paise, seconds vs milliseconds), the conversion happens
 * in `nativeProviders.ts`, not here, so this file stays a faithful description
 * of what Android actually sends.
 *
 * Nothing here throws when the module is missing. A build without the native
 * layer is a supported configuration: it is how the UI is developed and tested.
 */
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

/* ------------------------------------------------------------------ *
 * Payloads, exactly as the Kotlin writes them
 * ------------------------------------------------------------------ */

export interface NativeProtectionState {
  state: string;
  microphoneActive: boolean;
  foregroundServiceActive: boolean;
  screenWatchActive: boolean;
  overlayVisible: boolean;
  guardianConnected: boolean;
  /** ACCESSIBILITY | DEMO | MOCK, or null when no provider can answer. */
  paymentSource: string | null;
}

export interface NativePaymentContext {
  active: boolean;
  /**
   * Integer paise, matching payment.schema.ts. The comment here used to say
   * rupees and the field was named `amount`; the bridge has always sent
   * `amountMinor` in paise, so the adapter read a field that did not exist and
   * then scaled it again. Naming the unit in the field is what stops that
   * recurring.
   */
  amountMinor: number | null;
  currency: string;
  payee: string | null;
  payeeHash: string | null;
  /** PaymentContextSource: ACCESSIBILITY | DEMO | MOCK. */
  source: string;
  packageName: string | null;
  /** Epoch milliseconds. The bridge sends a number, not an ISO string. */
  observedAt: number;
}

export interface NativeCallContext {
  active: boolean;
  callerKnown: boolean;
  durationSeconds: number;
  /** False when the platform refused to give us call audio. */
  audioFromMicrophone: boolean;
}

export interface NativeNotificationContext {
  suspicion: number;
  matchCount: number;
  lookbackMinutes: number;
  /**
   * Redacted excerpts of the notifications that were kept -- links, amounts and
   * long digit runs already stripped native-side.
   *
   * The bridge has always sent these; they were simply not declared here, so
   * the only copy of the actual scam wording on the device was thrown away at
   * the type boundary and the manipulation model never saw a word of it.
   */
  excerpts?: string[];
}

export interface NativeAiBackend {
  engine: string;
  model: string;
  /** CPU | NNAPI | QNN | XNNPACK | HEURISTIC | UNAVAILABLE — measured, not assumed. */
  backend: string;
  isLocal: boolean;
  isReady: boolean;
  lastLatencyMs?: number;
  degradedReason: string | null;
  probes?: Array<{backend: string; available: boolean; detail: string}>;
}

export interface NativePermissionState {
  microphone: boolean;
  phoneState: boolean;
  accessibility: boolean;
  notifications: boolean;
  overlay: boolean;
  online: boolean;
}

/**
 * A window of speech. Note what is NOT here: the transcript.
 *
 * The PCM deliberately never crosses the bridge — audio stays native. That
 * also means JS currently has no text to classify; see
 * `mobile/INTEGRATION.md` §9, which is the open question for this seam.
 */
export interface NativeSpeechSegment {
  durationMs: number;
  sampleCount: number;
  /** Set when the local ASR produces one. Absent today. */
  transcript?: string;
  /**
   * The utterance as base64 WAV, present only when the user has switched cloud
   * transcription on. Absent by default: the microphone permission means Ruko
   * may listen on the device, not that audio may leave it.
   */
  audioWavBase64?: string;
  sampleRateHz?: number;
}

export interface NativeError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface RukoNativeSpec {
  /**
   * Allow a speech segment's audio to reach JavaScript. Off until called with
   * true, so audio leaving the device stays the user's decision.
   */
  setShareAudioWithJs(enabled: boolean): Promise<boolean>;
  startProtection(): Promise<NativeProtectionState>;
  /**
   * Watch payment screens without starting the microphone.
   *
   * Resolves true when the accessibility service is delivering events right
   * now, false when the wiring is in place but the service is not up yet. It
   * does not reject for that case: the provider is held statically on the
   * native side, so attaching early is correct and the service picks it up
   * whenever the system starts it.
   */
  startPaymentWatch(): Promise<boolean>;
  stopPaymentWatch(): Promise<boolean>;
  stopProtection(): Promise<NativeProtectionState>;
  getProtectionState(): Promise<NativeProtectionState>;
  signal(name: string): Promise<NativeProtectionState>;
  getPaymentContext(): Promise<NativePaymentContext | null>;
  getCallContext(): Promise<NativeCallContext | null>;
  getNotificationContext(): Promise<NativeNotificationContext | null>;
  getDeviceAIBackend(): Promise<NativeAiBackend | null>;
  getPermissionState(): Promise<NativePermissionState>;
  openSettingsFor(permission: string): Promise<boolean>;
  /**
   * Drive a payment through the real pipeline. Takes integer paise, matching
   * payment.schema.ts and the Kotlin signature -- it was declared as rupees
   * here, which would have shown an amount a hundred times too small.
   */
  beginDemoPayment(amountMinor: number, payee: string, payeeId: string): Promise<void>;
  /**
   * Draws the interruption over the foreground app. Rejects when the overlay
   * permission is missing, which is a real outcome the caller must surface —
   * not a detail to swallow.
   */
  showIntervention(
    headline: string,
    reason: string,
    amountLabel: string,
    payee: string,
    requiresGuardian: boolean,
  ): Promise<boolean>;
  hideIntervention(): Promise<boolean>;
  endDemoPayment(): Promise<void>;
}

/** Event names are namespaced on the native side; keep them in one place. */
export const NATIVE_EVENTS = {
  protectionState: 'ruko:onProtectionState',
  speechSegment: 'ruko:onSpeechSegment',
  callStateChanged: 'ruko:onCallStateChanged',
  error: 'ruko:onNativeError',
  paymentDetected: 'ruko:onPaymentDetected',
  interventionResolved: 'ruko:onInterventionResolved',
} as const;

export type NativeEventName = (typeof NATIVE_EVENTS)[keyof typeof NATIVE_EVENTS];

const MODULE_NAME = 'RukoNative';

const nativeModule = (NativeModules as Record<string, unknown>)[MODULE_NAME] as
  | RukoNativeSpec
  | undefined;

/** True only on a build that actually ships the native module. */
export function hasNativeModule(): boolean {
  return Platform.OS === 'android' && !!nativeModule;
}

export function getNativeModule(): RukoNativeSpec | null {
  return hasNativeModule() ? (nativeModule as RukoNativeSpec) : null;
}

let emitter: NativeEventEmitter | null = null;

export function getNativeEmitter(): NativeEventEmitter | null {
  if (!hasNativeModule()) {
    return null;
  }
  if (!emitter) {
    emitter = new NativeEventEmitter(nativeModule as never);
  }
  return emitter;
}

/**
 * Subscribes to a native event, returning a no-op unsubscribe when the module
 * is absent so callers need no branching.
 */
export function onNativeEvent<T>(
  name: NativeEventName,
  listener: (payload: T) => void,
): () => void {
  const e = getNativeEmitter();
  if (!e) {
    return () => {};
  }
  const sub = e.addListener(name, listener);
  return () => sub.remove();
}

/** A native call that rejects means "unknown", never "fine". */
export async function safeNative<T>(fn: () => Promise<T> | undefined): Promise<T | null> {
  try {
    const value = await fn();
    return value ?? null;
  } catch {
    return null;
  }
}
