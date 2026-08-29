/**
 * The trusted circle: who is told when Ruko stops something.
 *
 * A link is directional and typed. `subject` is the person being protected,
 * `guardian` is who gets told. A parent watching a child and a grown child
 * watching an ageing parent are the same row with the roles swapped, so both
 * directions are two rows rather than two features.
 *
 * Only the subject can propose a link and only the guardian can accept it, so
 * nobody can quietly add themselves as someone's guardian. That rule is a
 * row-level security policy in Postgres, not a check in this file — a client
 * can be decompiled and edited, a policy cannot.
 */
import {supabase} from './supabase';

export type Relationship =
  | 'parent' | 'child' | 'spouse' | 'sibling' | 'friend' | 'caregiver' | 'other';
export type LinkStatus = 'pending' | 'accepted' | 'revoked';
export type AlertKind = 'payment' | 'call' | 'message' | 'sextortion';
export type AlertBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TrustedLink {
  id: string;
  subject_id: string;
  guardian_id: string | null;
  guardian_email: string | null;
  relationship: Relationship;
  status: LinkStatus;
  created_at: string;
}

export interface Alert {
  id: string;
  subject_id: string;
  kind: AlertKind;
  band: AlertBand;
  score: number;
  reasons: string[];
  amount_minor: number | null;
  payee_label: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

/** The score at or above which a guardian is told. */
export const NOTIFY_AT = 50;

/**
 * Raise an alert to the circle. Deliberately takes the finished, human-readable
 * reasons rather than the evidence that produced them: the guardian needs to
 * know *why* to call, and the transcript is not theirs to read.
 */
export async function raiseAlert(input: {
  subjectId: string;
  kind: AlertKind;
  band: AlertBand;
  score: number;
  reasons: string[];
  amountMinor?: number | null;
  payeeLabel?: string | null;
}): Promise<{error: string | null}> {
  if (input.score < NOTIFY_AT) {
    // Below the line Ruko stays quiet. Telling a parent about every ₹200
    // payment is how a family turns the alerts off before the day one matters.
    return {error: null};
  }
  const {error} = await supabase.from('alerts').insert({
    subject_id: input.subjectId,
    kind: input.kind,
    band: input.band,
    score: Math.round(input.score),
    reasons: input.reasons,
    amount_minor: input.amountMinor ?? null,
    payee_label: input.payeeLabel ?? null,
  });
  return {error: error?.message ?? null};
}

/** Alerts about the people this user guards, newest first. */
export async function listIncomingAlerts(limit = 50): Promise<Alert[]> {
  const {data} = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', {ascending: false})
    .limit(limit);
  return (data as Alert[]) ?? [];
}

/**
 * Live alerts. Row-level security decides what arrives here, so a subscriber
 * cannot widen its own view by changing the filter.
 */
export function subscribeToAlerts(onAlert: (alert: Alert) => void) {
  const channel = supabase
    .channel('ruko-alerts')
    .on(
      'postgres_changes',
      {event: 'INSERT', schema: 'ruko', table: 'alerts'},
      payload => onAlert(payload.new as Alert),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Invite a guardian by email. Nobody knows another person's user id, so the
 * invite names an address and is claimed by whoever signs in with it. Until
 * then guardian_id is null and the link grants nothing -- alerts require an
 * accepted link, so an unclaimed invite cannot leak anything.
 */
export async function inviteGuardian(
  guardianEmail: string,
  relationship: Relationship,
): Promise<{error: string | null}> {
  const {data: session} = await supabase.auth.getSession();
  const me = session.session?.user;
  if (!me) return {error: 'not signed in'};
  const email = guardianEmail.trim().toLowerCase();
  if (email === (me.email ?? '').toLowerCase()) {
    return {error: 'That is your own address — invite someone else.'};
  }
  const {error} = await supabase
    .from('trusted_links')
    .insert({subject_id: me.id, guardian_email: email, relationship});
  if (error?.code === '23505') {
    return {error: 'You have already invited that address.'};
  }
  return {error: error?.message ?? null};
}

/** Claim an invite addressed to this account. */
export async function acceptInvite(linkId: string): Promise<{error: string | null}> {
  const {data: session} = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return {error: 'not signed in'};
  const {error} = await supabase
    .from('trusted_links')
    .update({status: 'accepted', guardian_id: me})
    .eq('id', linkId);
  return {error: error?.message ?? null};
}

export async function acceptLink(linkId: string): Promise<{error: string | null}> {
  const {error} = await supabase
    .from('trusted_links')
    .update({status: 'accepted'})
    .eq('id', linkId);
  return {error: error?.message ?? null};
}

export async function listLinks(): Promise<TrustedLink[]> {
  const {data} = await supabase.from('trusted_links').select('*');
  return (data as TrustedLink[]) ?? [];
}
