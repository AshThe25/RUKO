/**
 * The payload behind the engineering screen (master spec §41).
 *
 * Every field here is either a real measurement or an explicit "not measured".
 * Nothing is estimated, defaulted to something impressive, or hardcoded. If
 * Ruko cannot determine something, the screen says so — a diagnostics screen
 * that lies is worse than no diagnostics screen, because it is what a technical
 * reviewer will check first.
 */

import type { InferenceBackend, ModelInfo } from '../contracts/index.ts';
import { AGENT_VERSION } from '../agent/rukoAgent.ts';
import { POLICY_VERSION } from './policy.ts';
import { ENGINE_VERSION } from './riskEngine.ts';
import { MAX_ACHIEVABLE_POINTS, THRESHOLDS, WEIGHTS, WEIGHTS_VERSION } from './weights.ts';
import { CONTRACTS_VERSION } from '../contracts/index.ts';

export interface EdgeDiagnostics {
  classifier: {
    modelVersion: string;
    /** Real sha256, or 'unverified:<expected>' when the platform cannot hash. */
    modelHash: string;
    /** What the runtime reported. Never what was requested. */
    backend: InferenceBackend;
    requestedBackend: InferenceBackend;
    backendMatchedRequest: boolean;
    loaded: boolean;
    quantization: string;
    sizeBytes: number | null;
    /** Null until inferences have actually run on this device. */
    measuredLatencyMsP50: number | null;
    measuredLatencyMsP95: number | null;
    isFallback: boolean;
    fallbackReason: string | null;
  };
  engine: {
    engineVersion: string;
    weightsVersion: string;
    policyVersion: string;
    agentVersion: string;
    contractsVersion: string;
    maxAchievablePoints: number;
    thresholds: Record<string, number>;
    weights: Record<string, number>;
  };
  runtime: {
    /**
     * Whether the core protection path needs the network. This is a structural
     * fact about the code, not a status: nothing in the risk layer, agent,
     * tools or classifier performs any network I/O, and an e2e test fails the
     * build if anything starts to.
     */
    coreRequiresNetwork: false;
    networkReachable: boolean | null;
    checkedAt: number;
  };
}

export function buildDiagnostics(input: {
  modelInfo: ModelInfo;
  isFallback: boolean;
  fallbackReason?: string | null;
  networkReachable?: boolean | null;
}): EdgeDiagnostics {
  const m = input.modelInfo;
  return {
    classifier: {
      modelVersion: m.modelVersion,
      modelHash: m.modelHash,
      backend: m.backend,
      requestedBackend: m.requestedBackend,
      backendMatchedRequest: m.backend === m.requestedBackend,
      loaded: m.loaded,
      quantization: m.quantization ?? 'none',
      sizeBytes: m.sizeBytes ?? null,
      measuredLatencyMsP50: m.measuredLatencyMsP50 ?? null,
      measuredLatencyMsP95: m.measuredLatencyMsP95 ?? null,
      isFallback: input.isFallback,
      fallbackReason: input.fallbackReason ?? null,
    },
    engine: {
      engineVersion: ENGINE_VERSION,
      weightsVersion: WEIGHTS_VERSION,
      policyVersion: POLICY_VERSION,
      agentVersion: AGENT_VERSION,
      contractsVersion: CONTRACTS_VERSION,
      maxAchievablePoints: MAX_ACHIEVABLE_POINTS,
      thresholds: { ...THRESHOLDS },
      weights: { ...WEIGHTS },
    },
    runtime: {
      coreRequiresNetwork: false,
      networkReachable: input.networkReachable ?? null,
      checkedAt: Date.now(),
    },
  };
}

/**
 * Three genuinely different states, and the screen must not blur them:
 * no model file exists at all, a hash was computed and matched, or the
 * platform could not hash the file so nothing was actually checked.
 */
function formatHash(hash: string): string {
  if (hash.startsWith('n/a')) return 'no model file (rules only)';
  if (hash.startsWith('unverified:')) {
    return `${hash.slice(11, 23)}… (expected; not verified on this device)`;
  }
  return `${hash.slice(0, 12)}… verified`;
}

/**
 * Lines for the engineering screen, already formatted. Kept here so the honesty
 * rules live with the data rather than in the UI layer.
 */
export function diagnosticsLines(d: EdgeDiagnostics): Array<[string, string]> {
  const c = d.classifier;
  return [
    ['Risk classifier', c.isFallback ? 'Local — rules only' : 'Local — on-device model'],
    ['Model', `${c.modelVersion}${c.loaded ? '' : ' (not loaded)'}`],
    ['Model hash', formatHash(c.modelHash)],
    ['Inference backend', c.backendMatchedRequest
      ? c.backend
      : `${c.backend} (requested ${c.requestedBackend})`],
    ['Quantization', c.quantization],
    ['Model size', c.sizeBytes === null ? '—' : `${(c.sizeBytes / 1e6).toFixed(1)} MB`],
    ['Inference latency', c.measuredLatencyMsP50 === null
      ? 'not yet measured on this device'
      : `${c.measuredLatencyMsP50} ms p50 · ${c.measuredLatencyMsP95} ms p95`],
    ['Risk engine', `${d.engine.engineVersion} · ${d.engine.weightsVersion}`],
    ['Policy', d.engine.policyVersion],
    ['Internet', d.runtime.networkReachable === null ? 'not checked'
      : d.runtime.networkReachable ? 'available (not required)' : 'offline'],
  ];
}
