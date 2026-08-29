/**
 * Public surface of Ruko's risk layer. Owner: Vedant.
 *
 * Everything downstream — the UI, the agent, the guardian bridge — should import
 * from here rather than reaching into individual files, so the internals can
 * change without breaking anyone.
 */

export { evaluateRisk, getRiskEngineConfig, ENGINE_VERSION, REASON_LABELS } from './riskEngine.ts';
export { decidePolicy, POLICY_VERSION, INTERVENTION_COPY } from './policy.ts';
export type { PolicyDecision } from './policy.ts';
export { buildProfile, evaluateBehaviour, seedHistory } from './behaviourEngine.ts';
export type { BehaviourProfile } from './behaviourEngine.ts';
export { buildPayeeIndex, evaluatePayee } from './payeeEngine.ts';
export type { PayeeRecord } from './payeeEngine.ts';
export { hashPayee, sha256Hex } from './hash.ts';
export {
  amountAnomalyFromRatio, frequencyAnomaly, mean, median, percentile, stdev, timeAnomaly,
} from './anomaly.ts';
export {
  WEIGHTS, WEIGHTS_VERSION, THRESHOLDS, FAMILY_MAX, REASON_FAMILY,
  MAX_ACHIEVABLE_POINTS, CORROBORATION_FRACTION, MIN_FAMILIES_FOR_CRITICAL,
  MIN_CONVERSATION_RELIABILITY, MIN_PROFILE_SAMPLE,
} from './weights.ts';
