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
  /**
   * Who proposed the link. An invitation reads "X added you as their parent",
   * and a name is the whole basis for deciding whether to accept it — nobody
   * can judge "Someone added you as their parent". Populated from the
   * `subject_email` column when the database has one, otherwise from the
   * inviter's profile, and left null if neither is readable.
   */
  subject_email?: string | null;
  subject_name?: string | null;
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
      {event: 'INSERT', schema: 'public', table: 'alerts'},
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
  // Record who is asking, the same way the row already records who is being
  // asked. Without it the invitee sees an anonymous request to become
  // someone's parent, and no profile lookup can help while the policy that
  // would allow one requires the very acceptance being decided.
  const row = {
    subject_id: me.id,
    guardian_email: email,
    relationship,
    subject_email: (me.email ?? '').toLowerCase() || null,
  };

  let {error} = await supabase.from('trusted_links').insert(row);

  // 42703 is "column does not exist": a database that has not had the
  // subject_email migration applied yet. Fall back rather than making invites
  // fail on a deployment that is one migration behind.
  if (error?.code === '42703') {
    const {subject_email: _omitted, ...withoutEmail} = row;
    ({error} = await supabase.from('trusted_links').insert(withoutEmail));
  }

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

/**
 * Every link this user can see, with the inviter's identity resolved.
 *
 * `guardian_email` is stored on the row, so the subject always knows who they
 * invited. The reverse was not true: nothing on the row said who *sent* an
 * invitation, so the invitee saw an anonymous request to become someone's
 * parent. This fills that in, preferring a stored `subject_email` column and
 * falling back to the inviter's profile row.
 *
 * The profile read is best-effort on purpose. Whether one user may read
 * another's profile is a row-level security question, and if the answer is no
 * the invitation still renders — without a name — rather than failing.
 */
export async function listLinks(): Promise<TrustedLink[]> {
  const {data} = await supabase.from('trusted_links').select('*');
  const links = (data as TrustedLink[]) ?? [];
  if (links.length === 0) return links;

  const {data: session} = await supabase.auth.getSession();
  const meId = session.session?.user?.id;

  // Links where someone else is the subject are invitations *to* this user.
  const inviterIds = [
    ...new Set(
      links
        .filter(l => l.subject_id !== meId && !l.subject_email)
        .map(l => l.subject_id),
    ),
  ];
  if (inviterIds.length === 0) return links;

  const {data: profiles} = await supabase
    .from('profiles')
    .select('id,email,display_name')
    .in('id', inviterIds);

  if (!profiles || profiles.length === 0) return links;

  const byId = new Map(
    (profiles as Array<{id: string; email: string | null; display_name: string | null}>).map(
      p => [p.id, p],
    ),
  );
  return links.map(l => {
    const p = byId.get(l.subject_id);
    if (!p) return l;
    return {
      ...l,
      subject_email: l.subject_email ?? p.email,
      subject_name: l.subject_name ?? p.display_name,
    };
  });
}

/** How to name whoever proposed a link, for the invitee to read. */
export function inviterLabel(link: TrustedLink): string | null {
  return link.subject_name?.trim() || link.subject_email?.trim() || null;
}
