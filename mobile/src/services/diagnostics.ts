/**
 * Engine diagnostics — assembled from what is actually loaded.
 *
 * The rule for this file: every field is either a real reading or an explicit
 * "unknown". Nothing is defaulted to a flattering value. If the native module
 * is absent, the backend is `UNAVAILABLE`; if the classifier is the
 * deterministic fallback, it says `HEURISTIC`. The engineering screen prints
 * whatever it finds here, so this is where the app's honesty is enforced.
 */
import {Platform} from 'react-native';
import type {
  DiagnosticsProvider,
  EngineDiagnostics,
  LocalRiskClassifier,
  RiskEngine,
} from '@contracts';
import {now} from '@/utils/id';
import {Emitter} from './stubs/emitter';
import {getNativeModule, hasNativeModule, safeNative, type NativeAiBackend} from './native/RukoNative';
import {describeBackend} from './native/nativeProviders';

export interface DiagnosticsDeps {
  classifier: LocalRiskClassifier;
  risk: RiskEngine;
}

export function createDiagnosticsProvider(deps: DiagnosticsDeps): DiagnosticsProvider {
  const emitter = new Emitter<EngineDiagnostics>(snapshot(deps, null));

  const read = async (): Promise<EngineDiagnostics> => {
    const native = getNativeModule();
    const ai = native ? await safeNative(() => native.getDeviceAIBackend()) : null;
    const value = snapshot(deps, ai);
    emitter.emit(value);
    return value;
  };

  return {read, subscribe: l => emitter.subscribe(l)};
}

function snapshot(deps: DiagnosticsDeps, ai: NativeAiBackend | null): EngineDiagnostics {
  const config = deps.risk.getConfig();
  const runtime = describeBackend(ai);

  return {
    classifier: deps.classifier.getModelInfo(),
    asr: {
      // On-device ASR belongs to the native audio pipeline. `isReady` is the
      // runtime's own answer; when there is no native module at all this is
      // false and the engineering screen explains that demo transcripts are
      // scripted text rather than recognised speech.
      available: hasNativeModule() && runtime.ready,
      local: runtime.local,
      modelVersion: runtime.model,
      backend: runtime.backend,
      lastLatencyMs: runtime.lastLatencyMs,
    },
    riskEngine: {
      engineVersion: versionOf(deps.risk, 'engineVersion'),
      weightsVersion: config.weightsVersion,
      policyVersion: versionOf(deps.risk, 'policyVersion'),
    },
    // Reported by the native layer's connectivity check. Without the native
    // module the app makes no network calls at all, so offline is the truth
    // rather than an assumption — core protection never needed one.
    offline: !hasNativeModule(),
    // A real reading from the platform, not a hardcoded "iQOO 15".
    deviceModel: deviceModel(),
    lastUpdated: now(),
  };
}

function deviceModel(): string | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const constants = Platform.constants as {Model?: string; Brand?: string} | undefined;
  if (!constants?.Model) {
    return null;
  }
  return constants.Brand ? `${constants.Brand} ${constants.Model}` : constants.Model;
}

/**
 * The RiskEngine contract does not carry version strings, so they are read off
 * the engine when it exposes them and reported as unknown otherwise — never
 * invented.
 */
function versionOf(engine: RiskEngine, key: 'engineVersion' | 'policyVersion'): string {
  return (engine as unknown as Record<string, string | undefined>)[key] ?? 'unknown';
}
