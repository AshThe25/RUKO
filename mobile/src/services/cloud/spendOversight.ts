/**
 * Telling a parent about spending.
 *
 * Kept deliberately separate from the manipulation path. A child buying game
 * credit is spending, not being manipulated: routing it through the risk score
 * would tell a parent they may be being scammed when they are not, and would
 * corrupt the number the intervention screen is built on.
 *
 * So this raises its own alert, with spend reason codes, and the console
 * renders it as spending rather than as an interception.
 */
import type {BehaviourStore, TransactionRecord} from '@contracts';
import {
  ADULT_POLICY,
  MINOR_POLICY,
  evaluateSpend,
  shouldNotifyGuardian,
  type SpendAssessment,
  type SpendBand,
  type SpendPolicy,
} from '@/risk/spendMonitor';
import {supabase} from './supabase';

/** Cooldown state. In memory: a restart may re-notify, which is the safe way to be wrong. */
let lastNotifiedAt: number | null = null;
let lastNotifiedBand: SpendBand | null = null;

export interface SpendCheck {
  assessment: SpendAssessment;
  notified: boolean;
  error: string | null;
}

/**
 * Call after a payment is recorded locally. Returns what was decided so the
 * screen can show it, whether or not anyone was told.
 */
export async function checkSpendAndNotify(
  behaviour: BehaviourStore,
  isMinor: boolean,
  now: number = Date.now(),
): Promise<SpendCheck> {
  const policy: SpendPolicy = isMinor ? MINOR_POLICY : ADULT_POLICY;
  // The whole local ledger is safe to hand over: evaluateSpend windows it.
  const history: TransactionRecord[] = await behaviour.listTransactions(200);
  const assessment = evaluateSpend(history, now, policy);

  if (!shouldNotifyGuardian(assessment, lastNotifiedAt, lastNotifiedBand, now, policy)) {
    return {assessment, notified: false, error: null};
  }

  const {data} = await supabase.auth.getSession();
  const me = data.session?.user.id;
  // Signed out, nobody to tell. The assessment still returns so the phone can
  // show it -- protection does not depend on an account.
  if (!me) return {assessment, notified: false, error: null};

  const {error} = await supabase.from('alerts').insert({
    subject_id: me,
    kind: 'payment',
    band: assessment.band,
    // Not a manipulation score. The window total is what a parent needs, and
    // capping at 100 keeps the column's own check constraint honest.
    score: Math.min(100, Math.round((assessment.windowTotalMinor / policy.cumulativeMinor) * 50)),
    reasons: assessment.reasons,
    amount_minor: assessment.windowTotalMinor,
    payee_label: null,
  });

  if (!error) {
    lastNotifiedAt = now;
    lastNotifiedBand = assessment.band;
  }
  return {assessment, notified: !error, error: error?.message ?? null};
}

/** Tests reset between cases; nothing else should need this. */
export function __resetSpendCooldown(): void {
  lastNotifiedAt = null;
  lastNotifiedBand = null;
}
