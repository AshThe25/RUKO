'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { getSupabase, supabaseConfigured } from './supabase';

/**
 * Google sign-in, and nothing else.
 *
 * The PKCE redirect is completed by supabase-js itself (`detectSessionInUrl`),
 * so there is no callback route to maintain and no token ever reaches a server
 * we run. `onAuthStateChange` also re-authorises the Realtime socket, which is
 * what lets RLS apply to the live feed as well as to the initial query.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    const supabase = getSupabase();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const { error: authError } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window === 'undefined' ? undefined : window.location.origin,
      },
    });
    if (authError) setError(authError.message);
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
  }, []);

  return { session, user: session?.user ?? null, loading, error, signIn, signOut };
}
