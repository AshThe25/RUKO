'use client';

export function SignIn({ onSignIn, error }: { onSignIn: () => void; error: string | null }) {
  return (
    <div className="signin">
      <p className="eyebrow">Ruko Guardian</p>
      <h1>Someone trusted you to watch.</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        Sign in to see when Ruko stops a payment or a call that looks like a scam —
        the score, the reasons and the amount. Never what was said.
      </p>

      {error ? <div className="notice" style={{ marginTop: 22 }}>{error}</div> : null}

      <button className="pill pill-solid" onClick={onSignIn}>
        Continue with Google
      </button>
    </div>
  );
}
