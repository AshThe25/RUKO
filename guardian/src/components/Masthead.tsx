import type { ConnectionState } from '@/lib/useGuardianSocket';
import type { Presence } from '@/lib/protocol';

type Props = {
  connection: ConnectionState;
  presence: Presence | null;
  paired: boolean;
};

/**
 * The connection pill describes the *phone*, not the browser tab. That is the
 * only connection state a trusted person actually cares about.
 */
function describe(connection: ConnectionState, presence: Presence | null) {
  if (connection === 'connecting') return { label: 'Connecting', tone: 'waiting' as const };
  if (connection === 'reconnecting') return { label: 'Reconnecting', tone: 'waiting' as const };
  if (connection === 'closed') return { label: 'Disconnected', tone: 'offline' as const };
  if (presence?.phoneConnected) return { label: 'Phone connected', tone: 'live' as const };
  return { label: 'Waiting for phone', tone: 'waiting' as const };
}

export function Masthead({ connection, presence, paired }: Props) {
  const state = describe(connection, presence);

  return (
    <header className="masthead">
      <div className="wordmark">
        Ruko <span>Guardian</span>
      </div>
      {paired ? (
        <div className="pill">
          <span className={`dot dot--${state.tone}`} aria-hidden />
          {state.label}
        </div>
      ) : null}
    </header>
  );
}
