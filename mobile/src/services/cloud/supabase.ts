/**
 * Supabase client for the trusted circle.
 *
 * Ruko's detection is on-device and stays there. This client exists for one
 * job only: telling a trusted person that something happened. It carries the
 * score, the band and the reasons — never the transcript, never the audio.
 * The `ruko` schema has nowhere to put those, so that limit is enforced by the
 * database rather than by remembering it at every call site.
 */
// Before supabase-js: it decides at import time whether S256 is available.
import './cryptoPolyfill';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL} from './config';


/** True when the app was built with real credentials. */
export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/**
 * supabase-js validates the URL inside its constructor and throws
 * "supabaseUrl is required" when it is empty. Building the client
 * unconditionally therefore turned a missing mobile/.env into a crash on
 * launch — in the one app whose stated promise is that it keeps protecting
 * someone with no cloud, no laptop and no network at all.
 *
 * So the client is only built when there is something to talk to. Every cloud
 * path is already gated on `cloudConfigured` (see createServices.ts), and the
 * placeholder below exists solely so this module still exports a client object
 * for the call sites in auth.ts. If one of them is ever reached with the cloud
 * unconfigured it fails as a network error, which is recoverable and visible —
 * not a white screen before the app has drawn anything.
 */
const INERT_URL = 'https://cloud-not-configured.invalid';

export const supabase = createClient(
  cloudConfigured ? SUPABASE_URL : INERT_URL,
  cloudConfigured ? SUPABASE_PUBLISHABLE_KEY : 'not-configured',
  {
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
});

