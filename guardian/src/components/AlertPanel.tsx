'use client';

import { useState } from 'react';

import {
  DISPLAYED_REASON_COUNT,
  type GuardianAction,
  type GuardianAlert,
  type GuardianDecisionAck,
  backendLabel,
  formatLatency,
  formatRupees,
} from '@/lib/protocol';

type Props = {
  alert: GuardianAlert;
  ack: GuardianDecisionAck | null;
  canAct: boolean;
  onDecide: (action: GuardianAction, note: string | null) => void;
  onDismiss: () => void;
};

export function AlertPanel({ alert, ack, canAct, onDecide, onDismiss }: Props) {
  const [confirmingAllow, setConfirmingAllow] = useState(false);
  const [note, setNote] = useState('');

  const { payment, assessment, runtime } = alert;
  // The engine already ordered these by points, descending. The console shows
  // the top few rather than keeping a second list that could disagree.
  const reasons = assessment.reasons.slice(0, DISPLAYED_REASON_COUNT);
  const decided = ack !== null && ack.accepted;

  if (decided) {
    return <DecisionMade ack={ack} onDismiss={onDismiss} />;
  }

  return (
    <div className="alert">
      <div className="alert__banner">Payment paused · needs your decision</div>

      <div className="alert__body">
        <p className="amount">{formatRupees(payment.amountMinor)}</p>
        <p className="payee">
          to {payment.payeeDisplayName}
          {payment.firstPayment ? <em> · first payment to this person</em> : null}
        </p>

        <div className="score">
          <span className="score__value">{assessment.score}</span>
          <span className="score__scale">/ 100</span>
          <span className="score__level">{assessment.level}</span>
        </div>
        <div
          className="meter"
          role="meter"
          aria-valuenow={assessment.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Risk score"
        >
          <div className="meter__fill" style={{ width: `${assessment.score}%` }} />
        </div>

        <ul className="reasons">
          {reasons.map((reason) => (
            <li key={reason.code}>{reason.label}</li>
          ))}
        </ul>

        {assessment.degraded ? (
          <p className="note">
            Ruko could not assess this confidently — some evidence was missing. Treat the
            reasons above as a prompt to check, not as a conclusion.
          </p>
        ) : null}

        <p className="note">
          <strong>The payment is already paused on the phone.</strong> Nothing has been sent. If
          you do nothing, it stays paused — the safe outcome needs no action from you.
        </p>

        <div className="runtime">
          <div className="runtime__item">
            <span className="runtime__label">Analysis</span>
            <span className="runtime__value">{runtime.isLocal ? 'On device' : 'Remote'}</span>
          </div>
          <div className="runtime__item">
            <span className="runtime__label">Compute</span>
            <span className="runtime__value">{backendLabel(runtime.backend)}</span>
          </div>
          <div className="runtime__item">
            <span className="runtime__label">Latency</span>
            <span className="runtime__value">{formatLatency(runtime.lastLatencyMs)}</span>
          </div>
          <div className="runtime__item">
            <span className="runtime__label">Model</span>
            <span className="runtime__value">{assessment.modelVersion}</span>
          </div>
        </div>

        {confirmingAllow ? (
          <div className="confirm">
            <h3>Release {formatRupees(payment.amountMinor)} to {payment.payeeDisplayName}?</h3>
            <p>
              Only do this if you have checked by some other route — a number you already had, or
              in person. Do not rely on anything the caller told you, including a number they
              gave you to call back.
            </p>
            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="note">Note for them (optional)</label>
              <input
                id="note"
                className="input"
                maxLength={160}
                placeholder="I checked with the bank myself"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn--primary btn--full"
                disabled={!canAct}
                onClick={() => onDecide('ALLOW', note)}
              >
                Yes, I have verified this — release it
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--full"
                onClick={() => setConfirmingAllow(false)}
              >
                Go back
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary btn--full"
              disabled={!canAct}
              onClick={() => onDecide('KEEP_BLOCKED', note)}
            >
              Keep it blocked
            </button>
            {/* Releasing money is the irreversible direction, so it is the
                quiet secondary action and takes a second, deliberate step. */}
            <button
              type="button"
              className="btn btn--ghost btn--full"
              disabled={!canAct}
              onClick={() => setConfirmingAllow(true)}
            >
              Allow this payment
            </button>
          </div>
        )}

        {!canAct ? (
          <p className="footnote">
            Reconnecting to the relay. The phone stays blocked until you decide.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DecisionMade({ ack, onDismiss }: { ack: GuardianDecisionAck; onDismiss: () => void }) {
  return (
    <div className="card quiet">
      <span className="dot dot--live" aria-hidden />
      <h1>Decision sent</h1>
      <p className="lede">
        {ack.reason
          ? `Recorded, but the phone was offline (${ack.reason}). It stays blocked until it reconnects — the safe direction.`
          : 'The phone has your decision. Ruko has already told them what you chose.'}
      </p>
      <div className="actions">
        <button type="button" className="btn btn--ghost btn--full" onClick={onDismiss}>
          Back to watching
        </button>
      </div>
    </div>
  );
}
