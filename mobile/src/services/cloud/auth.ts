/**
 * Sign-in for the trusted circle.
 *
 * Ruko's protection works signed out — detection is on-device and needs no
 * account. Signing in buys exactly one thing: the ability to tell someone.
 * That is why this is not a gate on the app; it is a gate on the circle.
 *
 * Email works today. Google is the same code path and starts working the
 * moment the provider is enabled on the project, so nothing here needs to
 * change when it is.
 */
import {Linking} from 'react-native';
import {supabase} from './supabase';

/** Where Google returns to. Registered as an intent-filter in AndroidManifest. */
export const REDIRECT_URL = 'ruko://auth';

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthResult = {user: AuthUser | null; error: string | null; needsConfirmation?: boolean};

function toUser(u: {id: string; email?: string | null} | null | undefined): AuthUser | null {
  return u ? {id: u.id, email: u.email ?? null} : null;
}

export async function currentUser(): Promise<AuthUser | null> {
  const {data} = await supabase.auth.getSession();
  return toUser(data.session?.user);
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const {data, error} = await supabase.auth.signInWithPassword({email, password});
  return {user: toUser(data.user), error: error?.message ?? null};
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  const {data, error} = await supabase.auth.signUp({email, password});
  if (error) return {user: null, error: error.message};
  // With confirmation required Supabase returns a user but no session. Saying
  // "check your email" is the honest response; pretending they are signed in
  // means the next write fails with a confusing permission error instead.
  const needsConfirmation = Boolean(data.user && !data.session);
  return {user: toUser(data.user), error: null, needsConfirmation};
}

export async function signOut(): Promise<void> {
  // `scope: 'global'` revokes the refresh token server-side, not just the copy
  // in this app's storage. A local-only sign-out leaves a token that can still
  // be refreshed, which is how a handed-over phone kept letting the previous
  // person back in without ever asking for a password.
  await supabase.auth.signOut({scope: 'global'});
}

/** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const {data} = supabase.auth.onAuthStateChange((_event, session) => {
    cb(toUser(session?.user));
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Mirror the auth user into ruko.profiles. The trusted-link tables reference
 * auth.users, but a guardian needs a name and an email to recognise who they
 * are being asked to watch, and auth.users is not readable from the client.
 */
export async function upsertProfile(user: AuthUser, isMinor: boolean): Promise<void> {
  const {error} = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email ?? '',
    is_minor: isMinor,
  });
  if (error) {
    // trusted_links and alerts both reference this row. If it is missing, the
    // first symptom is not a profile error — it is an alert insert failing a
    // foreign key, which reads as "the guardian was never told".
    console.warn(`[ruko-auth] profile upsert failed: ${error.message} (${error.code ?? '-'})`);
  }
}

/**
 * Google sign-in.
 *
 * Supabase mints the authorisation URL; the system browser handles it, which
 * is what keeps Google's password off this app's screen entirely. The browser
 * returns to ruko://auth and `completeOAuth` swaps the code for a session.
 *
 * PKCE is used rather than an implicit flow: a mobile app cannot keep a client
 * secret, so the code exchange is bound to a verifier this device generated.
 */
export async function signInWithGoogle(): Promise<{error: string | null}> {
  const {data, error} = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
      // Always show Google's account chooser.
      //
      // Without this Google silently reuses whatever account the system
      // browser last signed in with, so on a shared or handed-over phone the
      // sign-in button appears to work and lands you in someone else's
      // account. That is precisely the wrong failure for an app whose whole
      // job is a second person watching over the first: a guardian who cannot
      // sign in as themselves cannot be a guardian.
      queryParams: {prompt: 'select_account'},
    },
  });
  if (error) return {error: error.message};
  if (!data?.url) return {error: 'no authorisation url returned'};

  // Deliberately not gated on canOpenURL: on Android 11+ it reports false for
  // https unless the manifest declares a <queries> block, so a phone with three
  // browsers installed still answers "no". openURL throws if it genuinely
  // cannot resolve, which is the honest signal.
  try {
    await Linking.openURL(data.url);
    return {error: null};
  } catch {
    return {error: 'could not open a browser to finish sign-in'};
  }
}

/**
 * Finish the flow from the deep link. Returns null when the URL is not an auth
 * callback, so the caller can pass every incoming link here safely.
 */
export async function completeOAuth(url: string): Promise<AuthResult | null> {
  if (!url.startsWith(REDIRECT_URL)) return null;
  // Logged on purpose: this is the one hop that cannot be tested off-device,
  // so it has to be observable in logcat. The code itself is single-use and
  // already spent by the time this resolves.
  console.log('[ruko-auth] deep link received, exchanging code');
  const code = new URL(url).searchParams.get('code');
  if (!code) {
    const err = new URL(url).searchParams.get('error_description');
    return {user: null, error: err ?? 'sign-in was cancelled'};
  }
  const {data, error} = await supabase.auth.exchangeCodeForSession(code);
  console.log(
    '[ruko-auth] exchange ' + (error ? 'FAILED: ' + error.message : 'ok, session established'),
  );
  return {user: toUser(data?.user), error: error?.message ?? null};
}

/** Listen for the OAuth return. Returns an unsubscribe. */
const handled = new Set<string>();

export function listenForOAuth(onDone: (result: AuthResult) => void): () => void {
  // getInitialURL and the 'url' event can both deliver the same link. An
  // authorisation code is single-use and its verifier is cleared on the first
  // exchange, so a second attempt fails rather than being harmlessly ignored.
  const once = (url: string) => {
    if (handled.has(url)) return;
    handled.add(url);
    void completeOAuth(url).then(r => {
      if (r) onDone(r);
    });
  };
  const sub = Linking.addEventListener('url', ({url}) => once(url));
  // A cold start arrives as the initial URL rather than an event.
  void Linking.getInitialURL().then(url => {
    if (url) once(url);
  });
  return () => sub.remove();
}
