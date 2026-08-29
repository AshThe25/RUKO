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
import {supabase} from './supabase';
import {NOTIFY_AT, type AlertBand} from './trustedCircle';

const BAND: Record<string, AlertBand> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

export class SupabaseGuardianChannel implements GuardianChannel {
  private state: GuardianConnectionState = 'UNPAIRED';
  private userId: string | null = null;

  /** Called once a session exists. Until then the channel reports disconnected. */
  async attach(): Promise<void> {
    const {data} = await supabase.auth.getSession();
    this.userId = data.session?.user.id ?? null;
    this.state = this.userId ? 'ONLINE' : 'UNPAIRED';
  }

  getState(): GuardianConnectionState {
    return this.state;
  }

  async sendAlert(alert: GuardianAlert): Promise<GuardianDecision | null> {
    // Below the notify line the circle is not told at all. A family that gets
    // pinged about every small payment turns the alerts off long before the
    // one that matters.
    if (alert.score < NOTIFY_AT || !this.userId) return null;

    const {data, error} = await supabase
      .from('alerts')
      .insert({
        subject_id: this.userId,
        kind: 'payment',
        band: BAND[alert.level] ?? 'HIGH',
        score: Math.round(alert.score),
        // Reasons are the human-readable strings the user is already shown.
        // The transcript is not sent, and the schema has no column for one.
        reasons: alert.reasons.map(r => (typeof r === 'string' ? r : r.code)),
        amount_minor: alert.amountMinor,
        payee_label: alert.payeeDisplayName,
      })
      .select('id')
      .single();

    if (error || !data) return null;

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
            schema: 'ruko',
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
