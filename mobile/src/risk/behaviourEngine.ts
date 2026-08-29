/**
 * Behaviour engine — builds a local statistical profile of how this user
 * normally pays, and scores how far the current payment sits outside it.
 *
 * This is deterministic. No model is involved. It runs entirely on device from
 * locally stored transaction records and never sends anything anywhere.
 *
 * THE CENTRAL RULE: a large amount is NOT evidence of fraud. Rent, fees, and
 * family transfers are large and completely normal. This engine reports "this is
 * unusual for you", and only the risk engine — after fusing conversation, payee
 * and call context — is allowed to turn that into a warning.
 */

import type { BehaviourEvidence, TransactionRecord } from '../contracts/index.ts';
import {
  amountAnomalyFromRatio,
  frequencyAnomaly,
  mean,
  median,
  percentile,
  timeAnomaly,
} from './anomaly.ts';
import { MIN_PROFILE_SAMPLE } from './weights.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface BehaviourProfile {
  sampleSize: number;
  medianAmountMinor: number | null;
  meanAmountMinor: number | null;
  p95AmountMinor: number | null;
  /** 24 buckets, counts of payments started in each hour of the local day. */
  hourHistogram: number[];
  /** Historical payments per hour, used as the frequency baseline. */
  paymentsPerHour: number;
  /** Epoch ms of the oldest record in the profile. */
  oldestTimestamp: number | null;
  mature: boolean;
}

/**
 * Build the profile from local history.
 *
 * `now` is injected rather than read from the clock so that every test is
 * deterministic and so the demo can seed a realistic history.
 */
export function buildProfile(history: TransactionRecord[], now: number): BehaviourProfile {
  const amounts = history.map((t) => t.amountMinor).filter((a) => Number.isFinite(a) && a > 0);
  const hourHistogram = new Array(24).fill(0);
  for (const t of history) {
    hourHistogram[new Date(t.timestamp).getHours()]++;
  }

  const oldest = history.length ? Math.min(...history.map((t) => t.timestamp)) : null;
  // Guard the denominator: a burst of records inside one hour would otherwise
  // produce an absurd baseline rate and suppress every frequency anomaly.
  const spanHours = oldest === null ? 0 : Math.max((now - oldest) / HOUR_MS, 24);

  return {
    sampleSize: amounts.length,
    medianAmountMinor: median(amounts),
    meanAmountMinor: mean(amounts),
    p95AmountMinor: percentile(amounts, 0.95),
    hourHistogram,
    paymentsPerHour: spanHours > 0 ? history.length / spanHours : 0,
    oldestTimestamp: oldest,
    mature: amounts.length >= MIN_PROFILE_SAMPLE,
  };
}

/**
 * Score the current payment against the profile.
 *
 * Returns `available: false` when there is no payment amount to score. Returns
 * `available: true, profileMature: false` when there IS an amount but not enough
 * history to judge it — a genuinely different state, and one the risk engine
 * handles by refusing to count the anomaly rather than by guessing.
 */
export function evaluateBehaviour(
  profile: BehaviourProfile,
  currentAmountMinor: number | null,
  now: number,
  recentPaymentTimestamps: number[] = [],
): BehaviourEvidence {
  const base = {
    source: 'LOCAL_STORE' as const,
    medianAmountMinor: profile.medianAmountMinor,
    meanAmountMinor: profile.meanAmountMinor,
    p95AmountMinor: profile.p95AmountMinor,
    sampleSize: profile.sampleSize,
    profileMature: profile.mature,
  };

  if (currentAmountMinor === null || !Number.isFinite(currentAmountMinor)) {
    return {
      ...base,
      available: false,
      unavailableReason: 'no payment amount available to compare',
      amountRatio: null,
      amountAnomaly: 0,
      frequencyAnomaly: 0,
      timeAnomaly: 0,
      profileMature: false,
    };
  }

  if (!profile.mature) {
    return {
      ...base,
      available: true,
      unavailableReason:
        `behaviour profile has ${profile.sampleSize} of ${MIN_PROFILE_SAMPLE} ` +
        'transactions needed; anomaly scores withheld',
      amountRatio: null,
      amountAnomaly: 0,
      frequencyAnomaly: 0,
      timeAnomaly: 0,
    };
  }

  // p95 is the reference rather than the median: the median of a spending
  // history is dominated by small everyday payments, so measuring a rent
  // transfer against it would make every large legitimate payment look extreme.
  const reference = profile.p95AmountMinor ?? profile.medianAmountMinor;
  const ratio = reference && reference > 0 ? currentAmountMinor / reference : null;

  const inLastHour = recentPaymentTimestamps.filter((t) => now - t <= HOUR_MS).length;

  return {
    ...base,
    available: true,
    amountRatio: ratio === null ? null : Number(ratio.toFixed(3)),
    amountAnomaly: amountAnomalyFromRatio(ratio),
    frequencyAnomaly: frequencyAnomaly(inLastHour, profile.paymentsPerHour),
    timeAnomaly: timeAnomaly(profile.hourHistogram, new Date(now).getHours()),
  };
}

/** Convenience for the demo and for tests: seed a plausible spending history. */
export function seedHistory(
  amountsMinor: number[],
  payeeHashes: string[],
  endingAt: number,
  spacingMs = DAY_MS,
): TransactionRecord[] {
  return amountsMinor.map((amountMinor, i) => ({
    id: `seed-${i}`,
    payeeHash: payeeHashes[i % payeeHashes.length],
    amountMinor,
    timestamp: endingAt - (amountsMinor.length - i) * spacingMs,
  }));
}
