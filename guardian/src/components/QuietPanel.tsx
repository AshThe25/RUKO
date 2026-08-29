import type { Presence } from '@/lib/protocol';

type Props = {
  presence: Presence | null;
  phoneDisplayName: string;
};

/**
 * The state this console spends almost all of its life in.
 *
 * "Ruko is quiet until it matters" applies here too: nothing blinks, nothing
 * counts up, and there is no dashboard to read. If this screen is boring, the
 * person you look after is fine.
 */
export function QuietPanel({ presence, phoneDisplayName }: Props) {
  const phoneOnline = presence?.phoneConnected ?? false;
  const name = presence?.phoneDisplayName || phoneDisplayName;

  return (
    <div className="card quiet">
      <span className={`dot ${phoneOnline ? 'dot--live' : 'dot--offline'}`} aria-hidden />
      <h1>{phoneOnline ? 'Nothing needs your attention' : 'Phone is offline'}</h1>
      <p className="lede">
        {phoneOnline ? (
          <>
            You are watching over <strong>{name}</strong>. If Ruko pauses a payment it thinks is
            being pushed on them, it will appear here straight away.
          </>
        ) : (
          <>
            <strong>{name}</strong> is not connected right now. Ruko is still protecting them on
            the phone itself — this console is an extra pair of eyes, not the protection.
          </>
        )}
      </p>
    </div>
  );
}
