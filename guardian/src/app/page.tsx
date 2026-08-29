'use client';

import { useState } from 'react';

import { AlertPanel } from '@/components/AlertPanel';
import { Masthead } from '@/components/Masthead';
import { PairPanel } from '@/components/PairPanel';
import { QuietPanel } from '@/components/QuietPanel';
import { type GuardianSession, useGuardianSocket } from '@/lib/useGuardianSocket';

export default function GuardianConsole() {
  const [session, setSession] = useState<GuardianSession | null>(null);
  const socket = useGuardianSocket(session);

  return (
    <main className="shell">
      <Masthead
        connection={socket.connection}
        presence={socket.presence}
        paired={session !== null}
      />

      {session === null ? (
        <PairPanel onPaired={setSession} />
      ) : socket.alert ? (
        <AlertPanel
          alert={socket.alert}
          ack={socket.ack}
          canAct={socket.connection === 'connected'}
          onDecide={socket.decide}
          onDismiss={socket.dismiss}
        />
      ) : (
        <QuietPanel presence={socket.presence} phoneDisplayName={session.phoneDisplayName} />
      )}

      {socket.lastError && !socket.lastError.recoverable ? (
        <p className="error" style={{ marginTop: 24, textAlign: 'center' }}>
          {socket.lastError.message}
        </p>
      ) : null}

      {socket.rejectedFrames > 0 ? (
        <p className="footnote">
          {socket.rejectedFrames} message{socket.rejectedFrames === 1 ? '' : 's'} from the relay
          could not be read and {socket.rejectedFrames === 1 ? 'was' : 'were'} ignored. This
          usually means the phone and this console are on different versions.
        </p>
      ) : null}
    </main>
  );
}
