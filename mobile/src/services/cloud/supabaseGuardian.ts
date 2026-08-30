/**
 * A GuardianChannel backed by Supabase.
 *
 * Same contract as the stub it replaces, so swapping it is confined to
 * createServices. The phone writes one row; Postgres row-level security
 * decides which guardians may read it, and Realtime pushes it to their
 * devices. There is no relay server in this path to run, deploy or breach.
 *
 * `sendAlert` resolves to null when nobody answers in time. That is not a
 * failure mode to paper over: the contract says the phone then decides alone,
 * which is the correct behaviour for a product that must work with no signal.
 */
import type {
  GuardianAlert,
  GuardianChannel,
  GuardianConnectionState,
  GuardianDecision,
} from '@contracts';
import {Emitter} from '@/services/stubs/emitter';
import {supabase} from './supabase';
import {NOTIFY_AT, type AlertBand} from './trustedCircle';

const BAND: Record<string, AlertBand> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

export class SupabaseGuardianChannel implements GuardianChannel {
  /**
   * Observable, and named to match the stub's, because the app subscribes to
   * this to decide whether escalating is even possible.
   *
   * It used to be a plain field. The UI subscribed to the stub channel's
   * emitter regardless of which channel was actually in use, so on any build
   * with credentials -- every real one -- the guardian pill read Offline
   * forever and `escalate()` returned before it ever called `sendAlert`. The
   * phone still told the user their trusted contact had been notified.
   */
  readonly state = new Emitter<GuardianConnectionState>('UNPAIRED');
  private userId: string | null = null;
  private unsubscribe: (() => void) | null = null;

  /**
   * Attach is called at start-up, long before anyone signs in, so reading the
   * session once left userId null for the life of the process: every alert was
   * dropped on the floor after a successful sign-in, silently. It now tracks
   * auth state for as long as the app runs.
   */
  async attach(): Promise<void> {
    const {data} = await supabase.auth.getSession();
    console.warn(
      `[ruko-guardian] attach: session at start = ${data.session?.user.id ?? 'none'}`,
    );
    this.setUser(data.session?.user.id ?? null);

    if (this.unsubscribe) return;
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      console.warn(
        `[ruko-guardian] auth event ${event}: user = ${session?.user.id ?? 'none'}`,
      );
      this.setUser(session?.user.id ?? null);
    });
    this.unsubscribe = () => sub.data.subscription.unsubscribe();
  }

  private setUser(id: string | null): void {
    this.userId = id;
    this.state.emit(id ? 'ONLINE' : 'UNPAIRED');
  }

  getState(): GuardianConnectionState {
    return this.state.value;
  }

  async sendAlert(alert: GuardianAlert): Promise<GuardianDecision | null> {
    // Below the notify line the circle is not told at all. A family that gets
    // pinged about every small payment turns the alerts off long before the
    // one that matters.
    if (alert.score < NOTIFY_AT) {
      console.warn(
        `[ruko-guardian] not escalating: score ${alert.score} is below the ` +
          `notify line of ${NOTIFY_AT}`,
      );
      return null;
    }
    if (!this.userId) {
      // Do not trust a value captured at start-up. attach() reads the session
      // once and then follows auth events, but a cold start races the restore
      // from storage, and a token that expired while the app was closed leaves
      // this null until a refresh lands. Re-reading here costs one call on the
      // rare path and is the difference between escalating and silently not.
      const {data} = await supabase.auth.getSession();
      const recovered = data.session?.user.id ?? null;
      if (recovered) {
        console.warn('[ruko-guardian] session was stale at start-up; recovered before sending');
        this.setUser(recovered);
      }
    }
    if (!this.userId) {
      // Genuinely signed out. Say so rather than looking like a guardian who
      // did not answer — the two are indistinguishable on screen otherwise.
      console.warn('[ruko-guardian] not escalating: nobody is signed in on this phone');
      return null;
    }

    const {data, error} = await supabase
      .from('alerts')
      .insert({
        subject_id: this.userId,
        kind: 'payment',
        band: BAND[alert.level] ?? 'HIGH',
        score: Math.round(alert.score),
        // The label, not just the code: a guardian has to read this and decide
        // whether to phone someone, and COERCION_DETECTED tells them nothing.
        // It is the same line already shown on the phone, so nothing new is
        // disclosed. The transcript is not sent and the schema has no column
        // for one. The console prefers label and falls back to code, so both
        // are included.
        reasons: alert.reasons.map(r =>
          typeof r === 'string' ? r : {code: r.code, label: r.label},
        ),
        amount_minor: alert.amountMinor,
        payee_label: alert.payeeDisplayName,
      })
      .select('id')
      .single();

    if (error || !data) {
      // This is the failure that looks exactly like a guardian ignoring you:
      // the alert row never existed, so nothing could ever arrive in the
      // console and no decision could ever come back. Swallowing it silently
      // cost a debugging session — an RLS refusal, a missing profiles row or a
      // dropped connection all land here and all present as "not reached".
      console.warn(
        '[ruko-guardian] alert insert FAILED, nothing was sent: ' +
          (error?.message ?? 'no row returned') +
          (error?.code ? ` (code ${error.code})` : '') +
          (error?.details ? ` — ${error.details}` : '') +
          (error?.hint ? ` hint: ${error.hint}` : ''),
      );
      return null;
    }
    console.warn(`[ruko-guardian] alert ${data.id} inserted; awaiting a decision`);

    return await this.awaitDecision(data.id, alert.sessionId, alert.expiresInSec);
  }

  /**
   * Wait for a guardian to acknowledge, but never longer than the phone is
   * willing to wait. Resolving null on timeout is the documented contract.
   */
  private awaitDecision(
    alertId: string,
    sessionId: string,
    expiresInSec: number,
  ): Promise<GuardianDecision | null> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (value: GuardianDecision | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void supabase.removeChannel(channel);
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), Math.max(1, expiresInSec) * 1000);

      const channel = supabase
        .channel(`alert-${alertId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'alerts',
            filter: `id=eq.${alertId}`,
          },
          payload => {
            const row = payload.new as {acknowledged_at: string | null};
            if (!row.acknowledged_at) return;
            // An acknowledgement is a guardian saying "I've got this", which
            // keeps the block in place. Only an explicit ALLOW should ever
            // release it, and nothing in this table can express that yet.
            finish({
              sessionId,
              decision: 'KEEP_BLOCKED',
              decidedAt: Date.parse(row.acknowledged_at) || Date.now(),
              guardianLabel: 'Trusted contact',
            });
          },
        )
        .subscribe();
    });
  }
}
