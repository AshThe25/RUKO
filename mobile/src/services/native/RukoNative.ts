/**
 * Typed access to the native Ruko module.
 *
 * The native side is Puneesh's (`android/.../bridge/`). This file is the
 * mobile layer's half of that seam: it discovers the module if it is installed,
 * types what we expect from it, and — critically — reports honestly when it is
 * not there, so `createServices` can fall back to stubs instead of the app
 * pretending it has device access it does not have.
 *
 * Nothing here throws on a missing module. A build without the native layer is
 * a supported configuration: it is how the UI is developed and tested.
 */
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {InferenceBackend} from '@contracts';

/** Shapes the native side sends us. Deliberately loose — validated on arrival. */
export interface NativeCallState {
  active: boolean;
  callerKnown: boolean | null;
  direction: 'INCOMING' | 'OUTGOING' | 'UNKNOWN';
  durationMs: number | null;
  startedBeforePayment: boolean | null;
}

export interface NativePaymentContext {
  active: boolean;
  amountMinor: number | null;
  payeeDisplayName: string | null;
  payeeHash: string | null;
  appPackage?: string;
  /** How the values were obtained — accessibility parse or the demo app. */
  parsed: 'ACCESSIBILITY' | 'DEMO';
}

export interface NativeNotificationContext {
  suspicion: number;
  matchedCategories: string[];
  count: number;
  windowMs: number;
}

export interface NativeSpeechChunk {
  /** Transcript for the window. Audio itself never crosses this boundary. */
  text: string;
  windowMs: number;
  /** ASR confidence, when the recogniser reports one. */
  asrConfidence: number | null;
  latencyMs: number | null;
}

export interface NativeAiBackend {
  backend: InferenceBackend;
  requestedBackend: InferenceBackend;
  modelVersion: string | null;
  modelHash: string | null;
  deviceModel: string | null;
}

export interface RukoNativeSpec {
  startProtection(): Promise<void>;
  stopProtection(): Promise<void>;
  startAudioSession(sessionId: string): Promise<void>;
  stopAudioSession(): Promise<void>;
  getCallState(): Promise<NativeCallState>;
  getPaymentContext(): Promise<NativePaymentContext>;
  getNotificationContext(): Promise<NativeNotificationContext>;
  getDeviceAIBackend(): Promise<NativeAiBackend>;
}

export type NativeEventName =
  | 'onCallStateChanged'
  | 'onPaymentContext'
  | 'onNotificationContext'
  | 'onSpeechChunk';

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
