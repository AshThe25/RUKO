import {useEffect} from 'react';
import {Vibration} from 'react-native';

import {supabase, cloudConfigured} from './supabase';
import {listAlertsIWatch, subscribeToAlerts, type Alert} from './trustedCircle';
import {showNativeIntervention} from '../native/nativeProviders';
import {formatMinor} from '@/utils/format';

/** How often to sweep for anything Realtime did not deliver. */
const POLL_MS = 5000;

/**
 * Watch, app-wide, for alerts raised by someone this phone guards.
 *
 * WHY NOT IN GuardianScreen. It was, and that made the warning conditional on
 * the guardian already looking at the right screen — precisely when they least
 * need telling. A parent is not sitting on the Guardian tab at the moment their
 * child is being talked into a payment.
 *
 * WHY IT WAITS FOR A SESSION. Realtime enforces the same row-level security as
 * a query, and it does that against the token on the socket. Subscribing at
 * mount races the session being restored from storage, and a socket that opened
 * anonymously is simply never sent the rows — no error, no events, a guardian
 * who is never told. So nothing subscribes until there is a user, and the
 * subscription is rebuilt whenever the session changes.
 *
 * WHY IT ALSO POLLS. Realtime is a delivery optimisation, not the source of
 * truth: a dropped socket, a sleeping radio or a table missing from the
 * publication all end the same way. A five-second sweep costs almost nothing
 * and means the worst case is a late warning rather than none. Anything already
 * seen is remembered, so the same alert never fires twice.
 */
export function useGuardianWatch(): void {
  useEffect(() => {
    if (!cloudConfigured) return;

    let live = true;
    let userId: string | null = null;
    let stopChannel: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Alerts already announced. Without this the poll would re-raise the
    // overlay every five seconds for as long as an alert sits unacknowledged.
    const announced = new Set<string>();
    let primed = false;

    const announce = async (row: Alert) => {
      if (!live || announced.has(row.id)) return;
      announced.add(row.id);
      // The first sweep after launch is for priming, not for shouting: alerts
      // from yesterday must not ambush the guardian on app open.
      if (!primed) return;

      const amount =
        row.amount_minor === null || row.amount_minor === undefined
          ? 'A payment'
          : formatMinor(row.amount_minor);

      // Long, uneven and repeated: felt through a pocket, unlike the single
      // tick of an ordinary notification.
      Vibration.vibrate([0, 600, 250, 600, 250, 900]);

      await showNativeIntervention({
        headline: 'Someone you watch over needs you.',
        reason:
          row.band === 'CRITICAL'
            ? 'Ruko stopped a payment that looks like a scam.'
            : 'Ruko flagged a payment as risky.',
        amountLabel: amount,
        payee: row.payee_label ?? 'an unnamed recipient',
        requiresGuardian: true,
      });
    };

    const sweep = async () => {
      if (!live || !userId) return;
      const rows = await listAlertsIWatch();
      for (const row of rows) {
        if (row.acknowledged_at) {
          announced.add(row.id); // handled already; never shout about it
          continue;
        }
        await announce(row);
      }
      primed = true;
    };

    const start = (id: string) => {
      userId = id;
      stopChannel?.();
      // Subscribed only now, with a token on the socket, so RLS lets the rows
      // through instead of silently filtering every one of them out.
      stopChannel = subscribeToAlerts(row => {
        if (row.subject_id === userId) return; // our own alert is not news
        void announce(row);
      });
      void sweep();
      if (!timer) timer = setInterval(() => void sweep(), POLL_MS);
    };

    const stop = () => {
      userId = null;
      stopChannel?.();
      stopChannel = null;
    };

    void supabase.auth.getSession().then(({data}) => {
      if (!live) return;
      const id = data.session?.user.id ?? null;
      if (id) start(id);
    });

    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      const id = session?.user.id ?? null;
      if (id && id !== userId) start(id);
      else if (!id) stop();
    });

    return () => {
      live = false;
      stop();
      if (timer) clearInterval(timer);
      sub.data.subscription.unsubscribe();
    };
  }, []);
}
