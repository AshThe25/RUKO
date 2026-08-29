/**
 * Ruko shared contracts — common primitives.
 * Contract version: contracts-v1
 *
 * Owner: Vedant (ML / risk). Changes require a CHANGELOG entry + team notice.
 */

export const CONTRACTS_VERSION = 'contracts-v1' as const;

/** A model / heuristic confidence, always normalised to the range [0, 1]. */
export type Confidence = number;

/** A risk score, always normalised to the range [0, 100]. */
export type RiskScore = number;

/** Epoch milliseconds. */
export type Timestamp = number;

/**
 * Where a piece of evidence came from. This matters for honesty: the UI and the
 * audit trail must be able to say "this came from a demo provider", never
 * present a mocked signal as if it were measured from the device.
 */
export type EvidenceSource =
  | 'ON_DEVICE_MODEL' // a real local model produced this
  | 'ON_DEVICE_HEURISTIC' // deterministic on-device rules (no model)
  | 'ANDROID_API' // read from a real Android API (call state, notifications)
  | 'ACCESSIBILITY' // parsed from a real accessibility node tree
  | 'LOCAL_STORE' // read from the local behaviour / payee database
  | 'DEMO' // Ruko's own controlled demo app — real pipeline, scripted input
  | 'MOCK'; // test fixture only. Must never appear in a shipped build.

/**
 * Every evidence block extends this. `available: false` means "we could not
 * measure this", which is NOT the same as a measured value of zero.
 */
export interface EvidenceBase {
  available: boolean;
  source: EvidenceSource;
  /** Why the evidence is unavailable, when it is. Surfaced in the audit trail. */
  unavailableReason?: string;
}

export function isAvailable<T extends EvidenceBase>(e: T | undefined | null): e is T {
  return !!e && e.available === true;
}

/** Clamp any number into [0, 1]. Defensive: model outputs are not trusted raw. */
export function clamp01(n: number): Confidence {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
