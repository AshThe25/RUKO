'use client';

import { useCallback, useEffect, useState } from 'react';

import { getSupabase } from './supabase';
import type { Profile, TrustedLink } from './types';

export interface Invite extends TrustedLink {
  /** Filled in when profiles are readable; otherwise the UI degrades to an id. */
  subject?: Pick<Profile, 'display_name' | 'email'> | null;
}

/**
 * Links where this person is the guardian.
 *
 * A `pending` row is an invitation: the subject created it naming this person,
 * and only the guardian may move it to `accepted` — that asymmetry is enforced
 * by RLS, so accepting is a plain update and the database decides whether it is
 * allowed.
 *
 * Subject names come from a second query rather than an embedded join, because
 * whether one person may read another's profile row is an RLS question we do not
 * want to hard-code a join around. If the read is refused the invitation still
 * renders, just without a name.
 */
export function useInvites(userId: string | null) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [accepted, setAccepted] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setInvites([]);
      setAccepted([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    setLoading(true);

    const { data, error: queryError } = await supabase
      .from('trusted_links')
      .select('*')
      .eq('guardian_id', userId);

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    const links = (data ?? []) as TrustedLink[];
    const subjectIds = [...new Set(links.map((l) => l.subject_id))];

    let profiles: Record<string, Pick<Profile, 'display_name' | 'email'>> = {};
    if (subjectIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id,display_name,email')
        .in('id', subjectIds);
      profiles = Object.fromEntries(
        (profileRows ?? []).map((p) => [
          (p as Profile).id,
          { display_name: (p as Profile).display_name, email: (p as Profile).email },
        ]),
      );
    }

    const decorated: Invite[] = links.map((l) => ({ ...l, subject: profiles[l.subject_id] ?? null }));
    setInvites(decorated.filter((l) => l.status === 'pending'));
    setAccepted(decorated.filter((l) => l.status === 'accepted'));
    setError(null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = useCallback(
    async (linkId: string) => {
      const { error: updateError } = await getSupabase()
        .from('trusted_links')
        .update({ status: 'accepted' })
        .eq('id', linkId);

      if (updateError) {
        setError(`Could not accept: ${updateError.message}`);
        return;
      }
      await load();
    },
    [load],
  );

  return { invites, accepted, loading, error, accept, reload: load };
}
