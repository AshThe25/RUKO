/**
 * Supabase client for the trusted circle.
 *
 * Ruko's detection is on-device and stays there. This client exists for one
 * job only: telling a trusted person that something happened. It carries the
 * score, the band and the reasons — never the transcript, never the audio.
 * The `ruko` schema has nowhere to put those, so that limit is enforced by the
 * database rather than by remembering it at every call site.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL} from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No URL to detect a session in on a phone; the OAuth deep link is handled
    // explicitly rather than by scraping window.location.
    detectSessionInUrl: false,
    // PKCE, not implicit: a phone app cannot hold a client secret, so the code
    // exchange is bound to a verifier this device generated.
    flowType: 'pkce',
  },
  // Everything Ruko owns lives in its own schema, so it shares a project
  // without touching anything in public.
  db: {schema: 'ruko'},
});

/** True when the app was built with real credentials. */
export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
