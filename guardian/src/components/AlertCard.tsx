'use client';

import {
  KIND_LABEL,
  bandTone,
  formatMinor,
  formatScore,
  formatWhen,
  humaniseReason,
  isAcknowledged,
  isSpendAlert,
  normaliseReasons,
} from '@/lib/alerts';
import type { Alert } from '@/lib/types';

const TONE_CLASS: Record<ReturnType<typeof bandTone>, string> = {
  critical: 'chip chip-critical',
  warm: 'chip chip-warm',
  cool: 'chip chip-cool',
  muted: 'chip chip-muted',
};

const TONE_COLOR: Record<ReturnType<typeof bandTone>, string> = {
  critical: 'var(--critical)',
  warm: 'var(--warm)',
  cool: 'var(--cool)',
  muted: 'var(--muted)',
};

export function AlertCard({
  alert,
  onAcknowledge,
}: {
  alert: Alert;
  onAcknowledge: (id: string) => void;
}) {
  const tone = bandTone(alert.band);
  const reasons = normaliseReasons(alert.reasons);
  const acked = isAcknowledged(alert);
  // Spending is a different kind of news from manipulation, and gets its own
  // words. Telling a parent their child "may be being scammed" when the truth
  // is "spent ₹3,000 on a game" would burn the credibility of every other
  // alert in this feed.
  const spend = isSpendAlert(alert);
  const score = typeof alert.score === 'number' ? Math.max(0, Math.min(100, alert.score)) : null;

  return (
    <article className={alert.band === 'CRITICAL' && !acked ? 'card card-critical' : 'card'}>
      <div className="alert-top">
        <span className={TONE_CLASS[tone]}>{alert.band}</span>
        <span className="chip chip-muted">{spend ? 'Spending' : (KIND_LABEL[alert.kind] ?? alert.kind)}</span>
        {acked ? <span className="chip chip-safe">Acknowledged</span> : null}
        <span className="alert-when">{formatWhen(alert.created_at)}</span>
      </div>

      <div className="alert-amount">{formatMinor(alert.amount_minor)}</div>
      <div className="alert-payee">
        {alert.payee_label
          ? `${spend ? 'at' : 'to'} ${alert.payee_label}`
          : spend
            ? 'Merchant not recorded'
            : 'Recipient not recorded'}
      </div>

      {spend ? null : (
      <div className="meter">
        <div className="meter-track">
          <div
            className="meter-fill"
            style={{ width: `${score ?? 0}%`, background: TONE_COLOR[tone] }}
          />
        </div>
        <div className="meter-value">{formatScore(alert.score)} / 100</div>
      </div>
      )}

      {reasons.length > 0 ? (
        <div className="reasons">
          {reasons.map((reason) => (
            <span className="chip chip-muted" key={reason}>
              {humaniseReason(reason)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="alert-foot">
        <span className="small">
          {acked
            ? 'Handled. No further action needed.'
            : spend
              ? 'A spending limit was crossed. Nothing is blocked — this is for your awareness.'
              : 'Waiting for someone to confirm they have seen this.'}
        </span>
        <button
          className="pill pill-solid pill-sm"
          disabled={acked}
          onClick={() => onAcknowledge(alert.id)}
        >
          {acked ? 'Acknowledged' : 'Acknowledge'}
        </button>
      </div>
    </article>
  );
}
