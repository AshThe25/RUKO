'use client';

import { useState } from 'react';

import { ClaimError, claimPairingCode } from '@/lib/relayClient';
import type { GuardianSession } from '@/lib/useGuardianSocket';

type Props = {
  onPaired: (session: GuardianSession) => void;
};

export function PairPanel({ onPaired }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = code.length === 6 && name.trim().length > 0 && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);
    try {
      const result = await claimPairingCode(code, name.trim());
      onPaired(result);
    } catch (cause) {
      setError(
        cause instanceof ClaimError ? cause.message : 'Something went wrong. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="stack">
        <p className="eyebrow">Pair with a phone</p>
        <p className="lede">
          Ask the person you look after to open Ruko and tap <strong>Add a guardian</strong>. They
          will read you a six-digit code.
        </p>

        <form onSubmit={submit} className="stack" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="code">Pairing code</label>
            <input
              id="code"
              className="input input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>

          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              className="input"
              maxLength={80}
              placeholder="Priya"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" className="btn btn--primary btn--full" disabled={!ready}>
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </form>

        <p className="footnote">
          A code works once and expires after ten minutes. You will only ever see a payment
          amount, a name, and the reasons Ruko was concerned — never a conversation, a recording,
          or an account number.
        </p>
      </div>
    </div>
  );
}
