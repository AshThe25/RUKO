/**
 * Pure statistics for Ruko's behaviour engine. No I/O, no state, no dependencies
 * — so it is trivially unit-testable and identical on device and in CI.
 *
 * All money is handled as integer paise. Floating-point rupees are never used.
 */

import { ANOMALY_RATIO_CEILING, ANOMALY_RATIO_FLOOR } from './weights.ts';

/** Median of a numeric sample. Returns null for an empty sample. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Linear-interpolated percentile (the "type 7" definition used by NumPy's
 * default and by R). Named explicitly because percentile definitions differ and
 * a risk threshold should not silently depend on which one a library picked.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.round(Math.sqrt(v));
}

/**
 * Map "this payment is R times the user's p95 payment" onto [0, 1].
 *
 *   ratio <= 1.5   -> 0.0   an ordinary payment, even a big one
 *   ratio >= 10    -> 1.0   far outside anything this user has ever done
 *   in between     -> log-scaled
 *
 * WHY LOG AND NOT LINEAR: spending is heavy-tailed. The step from 2x to 3x a
 * user's normal payment is a much bigger deal than the step from 20x to 21x, and
 * a linear curve would put almost all of its resolution in a range nobody ever
 * reaches. Log scaling puts the resolution where real payments actually live.
 *
 * WHY THE FLOOR IS 1.5 AND NOT 1.0: by construction 5% of a user's payments
 * exceed their own p95. A floor at 1.0 would therefore mark one payment in
 * twenty as anomalous, which is a warning the user learns to ignore.
 */
export function amountAnomalyFromRatio(ratio: number | null): number {
  if (ratio === null || !Number.isFinite(ratio)) return 0;
  if (ratio <= ANOMALY_RATIO_FLOOR) return 0;
  if (ratio >= ANOMALY_RATIO_CEILING) return 1;
  const scaled =
    Math.log(ratio / ANOMALY_RATIO_FLOOR) /
    Math.log(ANOMALY_RATIO_CEILING / ANOMALY_RATIO_FLOOR);
  return Math.min(1, Math.max(0, scaled));
}

/**
 * Frequency anomaly: how unusual is this many payments in the last hour?
 * Compares against the user's own historical hourly rate, with a hard floor so
 * that a quiet user is not flagged for making three payments in an afternoon.
 */
export function frequencyAnomaly(
  paymentsInLastHour: number,
  historicalPaymentsPerHour: number,
): number {
  const expected = Math.max(historicalPaymentsPerHour, 0.05);
  const tolerated = Math.max(3, expected * 4);
  if (paymentsInLastHour <= tolerated) return 0;
  return Math.min(1, (paymentsInLastHour - tolerated) / (tolerated * 2));
}

/**
 * Time anomaly: is this hour-of-day one the user essentially never transacts in?
 * `hourHistogram` holds 24 counts. Returns 0 when there is not enough history
 * for the histogram to mean anything — an empty histogram is not evidence.
 */
export function timeAnomaly(hourHistogram: number[], hour: number, minSample = 20): number {
  if (hourHistogram.length !== 24) return 0;
  const total = hourHistogram.reduce((a, b) => a + b, 0);
  if (total < minSample) return 0;
  // Pool the hour with its two neighbours: 2am and 3am are the same behaviour,
  // and an exact-hour histogram is far too sparse at realistic sample sizes.
  const h = ((hour % 24) + 24) % 24;
  const pooled =
    hourHistogram[(h + 23) % 24] + hourHistogram[h] + hourHistogram[(h + 1) % 24];
  const share = pooled / total;
  // Uniform behaviour would give 3/24 = 0.125 for a 3-hour window.
  if (share >= 0.06) return 0;
  return Math.min(1, (0.06 - share) / 0.06);
}
