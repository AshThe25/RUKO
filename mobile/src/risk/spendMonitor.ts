/**
 * Spend oversight — the "my child spent ₹4,000 on a game this afternoon" signal.
 *
 * WHY THIS IS NOT PART OF THE RISK ENGINE: everything in riskEngine.ts answers
 * one question — is this person being *manipulated* into paying? A twelve year
 * old buying skins is not being manipulated; they are just spending. Routing
 * that through the manipulation score would tell a parent "you may be being
 * scammed", which is false, and would poison the one number the intervention
 * screen is built around. So this is a parallel, deterministic signal with its
 * own thresholds, and the two never mix.
 *
 * It is entirely arithmetic. No model, no inference, nothing to be wrong about
 * — which is exactly right for something that notifies another human being.
 *
 * THE TWO THINGS PARENTS ACTUALLY ASK FOR:
 *   1. "tell me if there is one big charge"
 *   2. "tell me if the small ones are adding up"
 * The second is the one existing tools miss. Six ₹500 purchases never trip a
 * per-transaction limit, and ₹3,000 is gone.
 */

import type { TransactionRecord } from '../contracts/index.ts';

export const SPEND_POLICY_VERSION = 'ruko-spend-policy-v1';

export type SpendTrigger =
  /** One payment at or above the single-payment ceiling. */
  | 'SINGLE_LARGE_PAYMENT'
  /** Many payments summing past the window ceiling — the ₹500 × 6 case. */
  | 'CUMULATIVE_THRESHOLD'
  /** Unusually many payments in a short burst, whatever the total. */
  | 'RAPID_REPEAT_PAYMENTS';

export type SpendBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SpendPolicy {
  /** A single payment at or above this notifies on its own. Paise. */
  singlePaymentMinor: number;
  /** Rolling window for the cumulative test, in minutes. */
  windowMinutes: number;
  /** Total spend inside the window that notifies. Paise. */
  cumulativeMinor: number;
  /** Payment count inside the burst window that notifies. */
  rapidCount: number;
  rapidWindowMinutes: number;
  /**
   * Do not notify again for this long once a window has already alerted.
   * Without it the seventh ₹500 sends a seventh message and the parent starts
   * ignoring all of them — which is worse than not notifying at all.
   */
  cooldownMinutes: number;
}

/**
 * Deliberately tighter for an account marked `is_minor` in ruko.profiles.
 * A parent watching a child wants a lower bar than an adult child watching an
 * ageing parent, and the link is typed, so we know which way round it is.
 */
export const MINOR_POLICY: SpendPolicy = {
  singlePaymentMinor: 100_000,   // ₹1,000
  windowMinutes: 180,            // 3 hours — one gaming session
  cumulativeMinor: 200_000,      // ₹2,000
  rapidCount: 4,
  rapidWindowMinutes: 30,
  cooldownMinutes: 60,
};

export const ADULT_POLICY: SpendPolicy = {
  singlePaymentMinor: 2_500_000, // ₹25,000
  windowMinutes: 360,
  cumulativeMinor: 5_000_000,    // ₹50,000
  rapidCount: 6,
  rapidWindowMinutes: 30,
  cooldownMinutes: 120,
};

export interface SpendAssessment {
  triggered: boolean;
  triggers: SpendTrigger[];
  band: SpendBand;
  /** Total spent inside the policy window, in paise. */
  windowTotalMinor: number;
  windowCount: number;
  /** The largest single payment inside the window, in paise. */
  largestMinor: number;
  /** Reason codes, shaped for the alert's `reasons` jsonb column. */
  reasons: string[];
  policyVersion: string;
}

function inWindow(history: TransactionRecord[], now: number, minutes: number): TransactionRecord[] {
  const cutoff = now - minutes * 60_000;
  return history.filter((t) => t.timestamp > cutoff && t.timestamp <= now);
}

/**
 * How far past the line we are decides the band. A parent should be able to
 * tell "slightly over" from "this is unusual" without reading the numbers.
 */
function bandFor(ratio: number, single: boolean): SpendBand {
  if (ratio >= 3) return 'CRITICAL';
  if (ratio >= 2) return 'HIGH';
  if (ratio >= 1) return single ? 'HIGH' : 'MEDIUM';
  return 'LOW';
}

/**
 * Evaluate spend against a policy. Pure: same inputs, same answer, always.
 *
 * `history` may contain anything; only what falls inside the window counts, so
 * the caller can hand over the whole local ledger without pre-filtering.
 */
export function evaluateSpend(
  history: TransactionRecord[],
  now: number,
  policy: SpendPolicy,
): SpendAssessment {
  const window = inWindow(history, now, policy.windowMinutes);
  const windowTotalMinor = window.reduce((sum, t) => sum + Math.max(0, t.amountMinor), 0);
  const largestMinor = window.reduce((max, t) => Math.max(max, t.amountMinor), 0);

  const burst = inWindow(history, now, policy.rapidWindowMinutes);

  const triggers: SpendTrigger[] = [];
  const reasons: string[] = [];
  let worst: SpendBand = 'LOW';

  const rank: Record<SpendBand, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const raise = (b: SpendBand) => {
    if (rank[b] > rank[worst]) worst = b;
  };

  if (largestMinor >= policy.singlePaymentMinor) {
    triggers.push('SINGLE_LARGE_PAYMENT');
    reasons.push('SINGLE_LARGE_PAYMENT');
    raise(bandFor(largestMinor / policy.singlePaymentMinor, true));
  }

  if (windowTotalMinor >= policy.cumulativeMinor) {
    triggers.push('CUMULATIVE_THRESHOLD');
    reasons.push('CUMULATIVE_THRESHOLD');
    raise(bandFor(windowTotalMinor / policy.cumulativeMinor, false));
  }

  // Deliberately independent of the amounts: a burst of tiny payments is the
  // signature of a game's purchase loop, and is worth saying out loud even when
  // the total is still modest.
  if (burst.length >= policy.rapidCount) {
    triggers.push('RAPID_REPEAT_PAYMENTS');
    reasons.push('RAPID_REPEAT_PAYMENTS');
    raise(burst.length >= policy.rapidCount * 2 ? 'HIGH' : 'MEDIUM');
  }

  return {
    triggered: triggers.length > 0,
    triggers,
    band: triggers.length > 0 ? worst : 'LOW',
    windowTotalMinor,
    windowCount: window.length,
    largestMinor,
    reasons,
    policyVersion: SPEND_POLICY_VERSION,
  };
}

/**
 * Whether to actually send this to the guardian, given when we last did.
 *
 * The cooldown is what keeps the feature usable. It is suppressed for a genuine
 * escalation — if the band has gone up since the last message, the situation
 * changed and the parent should hear about it even inside the quiet period.
 */
export function shouldNotifyGuardian(
  assessment: SpendAssessment,
  lastNotifiedAtMs: number | null,
  lastNotifiedBand: SpendBand | null,
  now: number,
  policy: SpendPolicy,
): boolean {
  if (!assessment.triggered) return false;
  if (lastNotifiedAtMs === null) return true;

  const rank: Record<SpendBand, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const escalated =
    lastNotifiedBand !== null && rank[assessment.band] > rank[lastNotifiedBand];
  if (escalated) return true;

  return now - lastNotifiedAtMs >= policy.cooldownMinutes * 60_000;
}

/** One plain sentence for the guardian console. No jargon, no blame. */
export function describeSpend(a: SpendAssessment, policy: SpendPolicy): string {
  const rupees = (minor: number) =>
    `₹${new Intl.NumberFormat('en-IN').format(Math.round(minor / 100))}`;

  if (a.triggers.includes('CUMULATIVE_THRESHOLD') && a.windowCount > 1) {
    return `${rupees(a.windowTotalMinor)} across ${a.windowCount} payments in the last ${
      policy.windowMinutes / 60
    } hours.`;
  }
  if (a.triggers.includes('SINGLE_LARGE_PAYMENT')) {
    return `A single payment of ${rupees(a.largestMinor)}.`;
  }
  if (a.triggers.includes('RAPID_REPEAT_PAYMENTS')) {
    return `${a.windowCount} payments in quick succession, ${rupees(a.windowTotalMinor)} in total.`;
  }
  return 'Spending is within the agreed limits.';
}
