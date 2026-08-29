'use client';

import { AlertCard } from '@/components/AlertCard';
import { InviteList } from '@/components/InviteList';
import { Masthead } from '@/components/Masthead';
import { SignIn } from '@/components/SignIn';
import { supabaseConfigured } from '@/lib/supabase';
import { useAlerts } from '@/lib/useAlerts';
import { useAuth } from '@/lib/useAuth';
import { useInvites } from '@/lib/useInvites';

/**
 * Two setup problems are worth naming precisely, because both look like "the
 * app is broken" and neither is fixable in this code: the `ruko` schema has to
 * be exposed to the API, and Google has to be enabled as a provider.
 */
function setupHint(message: string | null): string | null {
  if (!message) return null;
  if (/invalid schema|PGRST106/i.test(message)) {
    return (
      'The API is not exposing the `ruko` schema yet. In Supabase: Project Settings → ' +
      'API → Exposed schemas → add "ruko", then reload.'
    );
  }
  if (/provider is not enabled|validation_failed/i.test(message)) {
    return (
      'Google sign-in is not enabled on this Supabase project. In Supabase: ' +
      'Authentication → Providers → Google → enable and add the OAuth client.'
    );
  }
  return null;
}

export default function GuardianConsole() {
  const { user, loading: authLoading, error: authError, signIn, signOut } = useAuth();
  const userId = user?.id ?? null;

  const { alerts, status, error: feedError, loading: feedLoading, acknowledge } = useAlerts(userId);
  const { invites, accepted, error: inviteError, accept } = useInvites(userId);

  if (!supabaseConfigured) {
    return (
      <main className="shell">
        <div className="notice">
          Supabase is not configured. Copy <code>guardian/.env.example</code> to{' '}
          <code>guardian/.env.local</code>, then restart <code>npm run dev</code>.
        </div>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="shell">
        <p className="small">Checking your session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="shell">
        <SignIn onSignIn={signIn} error={setupHint(authError) ?? authError} />
      </main>
    );
  }

  const problem = feedError ?? inviteError;
  const hint = setupHint(problem);

  return (
    <main className="shell">
      <Masthead user={user} status={status} onSignOut={signOut} />

      {hint ? <div className="notice notice-warm">{hint}</div> : null}
      {problem && !hint ? <div className="notice">{problem}</div> : null}

      <InviteList invites={invites} accepted={accepted} onAccept={accept} />

      <section className="section">
        <div className="section-head">
          <h2>Alerts</h2>
          <span className="small">
            {alerts.length === 0 ? 'nothing yet' : `${alerts.length} in view`}
          </span>
        </div>

        {feedLoading ? (
          <p className="small">Loading…</p>
        ) : alerts.length === 0 ? (
          <div className="empty">
            <p className="lede">Nothing has needed your attention.</p>
            <p className="small" style={{ marginTop: 8 }}>
              If Ruko stops a risky payment or call, it appears here immediately — you
              will not need to refresh.
            </p>
          </div>
        ) : (
          alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onAcknowledge={acknowledge} />
          ))
        )}
      </section>
    </main>
  );
}
