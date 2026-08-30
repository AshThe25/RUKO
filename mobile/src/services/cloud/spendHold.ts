/**
 * Holding a payment until a guardian decides.
 *
 * What this can and cannot do, stated plainly because it is easy to overclaim:
 * Ruko cannot cancel a payment inside GPay, PhonePe or any other app. No public
 * Android API lets one app block another's transaction. What it can do is
 * refuse to get out of the way -- a full-screen hold the person has to deal
 * with, which interrupts the decision rather than the transfer.
 *
 * For a child that is the effective mechanism anyway: the barrier is social,
 * not technical. Enforcement needs OEM integration, and this is the shape that
 * would slot into it.
 */
import {supabase} from './supabase';

export type Approval = 'pending' | 'approved' | 'denied';

export interface HoldState {
  alertId: string;
  approval: Approval;
  expiresAt: number | null;
}

/** How long a hold stands before it releases itself. */
export const HOLD_MINUTES = 30;

/**
 * Raise a hold and return its id. The guardian sees it as a decision to make
 * rather than a notice to dismiss.
 */
export async function requestApproval(input: {
  subjectId: string;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  score: number;
  reasons: string[];
  amountMinor: number;
}): Promise<{alertId: string | null; error: string | null}> {
  const expires = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();
  const {data, error} = await supabase
    .from('alerts')
    .insert({
      subject_id: input.subjectId,
      kind: 'payment',
      band: input.band,
      score: Math.min(100, Math.round(input.score)),
      reasons: input.reasons,
      amount_minor: input.amountMinor,
      requires_approval: true,
      hold_expires_at: expires,
    })
    .select('id')
    .single();
  return {alertId: data?.id ?? null, error: error?.message ?? null};
}

/**
 * Watch one hold. Resolves when a guardian decides, or when the hold expires.
 *
 * Expiry resolves to 'approved' deliberately. A guardian who is asleep must not
 * leave someone unable to pay for anything, and a hold that never resolves is
 * how people learn to switch protection off entirely. The user is told the hold
 * lapsed rather than that anyone agreed.
 */
export function watchHold(
  alertId: string,
  onDecision: (approval: Approval, reason: 'decided' | 'expired') => void,
): () => void {
  let settled = false;
  const finish = (a: Approval, why: 'decided' | 'expired') => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    void supabase.removeChannel(channel);
    onDecision(a, why);
  };

  const timer = setTimeout(() => finish('approved', 'expired'), HOLD_MINUTES * 60_000);

  const channel = supabase
    .channel(`hold-${alertId}`)
    .on(
      'postgres_changes',
      {event: 'UPDATE', schema: 'public', table: 'alerts', filter: `id=eq.${alertId}`},
      payload => {
        const row = payload.new as {approval?: Approval};
        if (row.approval === 'approved' || row.approval === 'denied') {
          finish(row.approval, 'decided');
        }
      },
    )
    .subscribe();

  return () => {
    settled = true;
    clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

/** Guardian side: approve or deny a hold. RLS refuses anyone else. */
export async function decideHold(
  alertId: string,
  approval: Exclude<Approval, 'pending'>,
): Promise<{error: string | null}> {
  const {data} = await supabase.auth.getSession();
  const me = data.session?.user.id;
  if (!me) return {error: 'not signed in'};
  const {error} = await supabase
    .from('alerts')
    .update({approval, decided_at: new Date().toISOString(), decided_by: me})
    .eq('id', alertId);
  return {error: error?.message ?? null};
}
