'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from './supabase';
import { sortAlerts, upsertAlert } from './alerts';
import { ALERT_COLUMNS, assertNoTranscript, type Alert } from './types';

const SELECT = ALERT_COLUMNS.join(',');

export type FeedStatus = 'connecting' | 'live' | 'error';

/**
 * The live alert feed.
 *
 * Reads the alerts this signed-in person is allowed to see — RLS decides that,
 * not this code — then keeps the list current over Supabase Realtime. INSERT
 * brings a new alert in; UPDATE is what makes an acknowledgement appear on every
 * other open console within the same second.
 *
 * `schema: 'public'` has to be repeated here: the client-level `db.schema` option
 * only applies to PostgREST queries, and a Realtime filter that omits it will
 * silently listen to `public` and never fire.
 */
export function useAlerts(userId: string | null) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const ingest = useCallback((row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const record = row as Record<string, unknown>;
    try {
      assertNoTranscript(record);
    } catch (e) {
      // Fail closed: refuse to render a row that broke the privacy contract.
      setError((e as Error).message);
      return;
    }
    setAlerts((current) => upsertAlert(current, record as unknown as Alert));
  }, []);

  useEffect(() => {
    if (!userId) {
      setAlerts([]);
      setLoading(false);
      return;
    }

    const supabase = getSupabase();
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error: queryError } = await supabase
        .from('alerts')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .limit(100);

      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setStatus('error');
      } else {
        try {
          (data ?? []).forEach((row) => assertNoTranscript(row as unknown as Record<string, unknown>));
          setAlerts(sortAlerts((data ?? []) as unknown as Alert[]));
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      }
      setLoading(false);
    })();

    const channel = supabase
      .channel('ruko-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => ingest(payload.new),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'alerts' },
        (payload) => ingest(payload.new),
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('error');
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, ingest]);

  /**
   * Mark an alert handled. The row is updated optimistically so the button
   * responds immediately, and rolled back if the write is refused — which is
   * what happens if RLS does not let this person acknowledge.
   */
  const acknowledge = useCallback(
    async (alertId: string) => {
      if (!userId) return;
      const previous = alerts;
      const when = new Date().toISOString();
      setAlerts((current) =>
        current.map((a) =>
          a.id === alertId ? { ...a, acknowledged_at: when, acknowledged_by: userId } : a,
        ),
      );

      const { error: updateError } = await getSupabase()
        .from('alerts')
        .update({ acknowledged_at: when, acknowledged_by: userId })
        .eq('id', alertId);

      if (updateError) {
        setAlerts(previous);
        setError(`Could not acknowledge: ${updateError.message}`);
      }
    },
    [alerts, userId],
  );

  return { alerts, status, error, loading, acknowledge };
}
