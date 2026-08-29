/**
 * Engine diagnostics — assembled from what is actually loaded.
 *
 * The rule for this file: every field is either a real reading or an explicit
 * "unknown". Nothing is defaulted to a flattering value. If the native module
 * is absent, the backend is `UNAVAILABLE`; if the classifier is the
 * deterministic fallback, it says `HEURISTIC`. The engineering screen prints
 * whatever it finds here, so this is where the app's honesty is enforced.
 */
import type {
  DiagnosticsProvider,
  EngineDiagnostics,
  LocalRiskClassifier,
  RiskEngine,
} from '@contracts';
import {now} from '@/utils/id';
import {Emitter} from './stubs/emitter';
import {getNativeModule, hasNativeModule} from './native/RukoNative';

export interface DiagnosticsDeps {
  classifier: LocalRiskClassifier;
  risk: RiskEngine;
  /** Overridden by tests; the app reads it from the native module. */
  deviceModel?: string | null;
}

export function createDiagnosticsProvider(deps: DiagnosticsDeps): DiagnosticsProvider {
  const emitter = new Emitter<EngineDiagnostics>(snapshot(deps, null));

  const read = async (): Promise<EngineDiagnostics> => {
    const native = getNativeModule();
    let ai = null;
    if (native) {
      try {
        ai = await native.getDeviceAIBackend();
      } catch {
        // A native module that cannot answer is reported as unknown, not as CPU.
        ai = null;
      }
    }
    const value = snapshot(deps, ai);
    emitter.emit(value);
    return value;
  };

  return {read, subscribe: l => emitter.subscribe(l)};
}

function snapshot(
  deps: DiagnosticsDeps,
  ai: Awaited<ReturnType<NonNullable<ReturnType<typeof getNativeModule>>['getDeviceAIBackend']>> | null,
): EngineDiagnostics {
  const config = deps.risk.getConfig();
  const classifier = deps.classifier.getModelInfo();

  return {
    classifier,
    asr: {
      // On-device ASR arrives with the native audio pipeline. Until then this
      // is `false`, and the engineering screen explains that demo transcripts
      // are scripted text rather than recognised speech.
      available: hasNativeModule(),
      local: hasNativeModule(),
      modelVersion: ai?.modelVersion ?? null,
      backend: ai?.backend ?? 'UNAVAILABLE',
      lastLatencyMs: null,
    },
    riskEngine: {
      engineVersion: engineVersionOf(deps.risk),
      weightsVersion: config.weightsVersion,
      policyVersion: policyVersionOf(deps.risk),
    },
    // The app makes no network calls at all in this build, so "offline" is the
    // truth rather than an assumption — core protection never needed one.
    offline: !hasNativeModule(),
    deviceModel: ai?.deviceModel ?? deps.deviceModel ?? null,
    lastUpdated: now(),
  };
}

/**
 * The RiskEngine contract does not carry its own version strings, so they are
 * read off the engine when it exposes them and reported as unknown otherwise —
 * never invented.
 */
function engineVersionOf(engine: RiskEngine): string {
  const candidate = (engine as unknown as {engineVersion?: string}).engineVersion;
  return candidate ?? 'unknown';
}

function policyVersionOf(engine: RiskEngine): string {
  const candidate = (engine as unknown as {policyVersion?: string}).policyVersion;
  return candidate ?? 'unknown';
}
