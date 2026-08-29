'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { WS_BASE } from './relayClient';
import {
  type GuardianAction,
  type GuardianActionAck,
  type Presence,
  type RelayError,
  type RiskAlert,
  envelope,
  parseFrame,
} from './protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export type GuardianSession = {
  sessionId: string;
  guardianToken: string;
  phoneDisplayName: string;
};

export type SocketView = {
  connection: ConnectionState;
  presence: Presence | null;
  alert: RiskAlert | null;
  ack: GuardianActionAck | null;
  lastError: RelayError | null;
  /** Frames the console refused to render because they failed validation. */
  rejectedFrames: number;
  decide: (action: GuardianAction, note: string | null) => void;
  dismiss: () => void;
};

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

export function useGuardianSocket(session: GuardianSession | null): SocketView {
  const [connection, setConnection] = useState<ConnectionState>('closed');
  const [presence, setPresence] = useState<Presence | null>(null);
  const [alert, setAlert] = useState<RiskAlert | null>(null);
  const [ack, setAck] = useState<GuardianActionAck | null>(null);
  const [lastError, setLastError] = useState<RelayError | null>(null);
  const [rejectedFrames, setRejectedFrames] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    if (session === null) return;

    closedByUsRef.current = false;

    const connect = () => {
      const url = `${WS_BASE}/guardian/${encodeURIComponent(session.sessionId)}?token=${encodeURIComponent(
        session.guardianToken,
      )}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setConnection(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

      socket.onopen = () => {
        attemptRef.current = 0;
        setConnection('connected');
      };

      socket.onmessage = (event) => {
        const frame = parseFrame(String(event.data));
        if (frame === null) {
          // Never render a frame we could not fully validate. Counting them
          // makes a protocol mismatch visible instead of silent.
          setRejectedFrames((n) => n + 1);
          return;
        }

        switch (frame.type) {
          case 'PAIR_ACK':
          case 'PRESENCE':
            setPresence(frame.payload);
            break;
          case 'RISK_ALERT':
            setAck(null);
            setAlert(frame.payload);
            break;
          case 'GUARDIAN_ACTION_ACK':
            setAck(frame.payload);
            break;
          case 'ERROR':
            setLastError(frame.payload);
            break;
          case 'PING':
            socket.send(JSON.stringify(envelope('PONG', session.sessionId, frame.payload)));
            break;
        }
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        if (closedByUsRef.current) {
          setConnection('closed');
          return;
        }

        // 4401 is an auth failure: the token is dead, so retrying is pointless
        // and would hammer the relay. Anything else is worth reconnecting for.
        if (event.code === 4401 || event.code === 4409) {
          setConnection('closed');
          setLastError({
            code: 'UNAUTHORIZED',
            message: 'This pairing is no longer valid. Ask the phone for a new code.',
            recoverable: false,
          });
          return;
        }

        setConnection('reconnecting');
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attemptRef.current, MAX_BACKOFF_MS);
        attemptRef.current += 1;
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUsRef.current = true;
      if (retryRef.current !== null) clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session]);

  const decide = useCallback(
    (action: GuardianAction, note: string | null) => {
      const socket = socketRef.current;
      if (session === null || socket === null || alert === null) return;
      if (socket.readyState !== WebSocket.OPEN) return;

      socket.send(
        JSON.stringify(
          envelope('GUARDIAN_ACTION', session.sessionId, {
            incidentId: alert.incidentId,
            action,
            guardianDisplayName: presence?.guardianDisplayName ?? 'Guardian',
            note: note && note.trim().length > 0 ? note.trim().slice(0, 160) : null,
          }),
        ),
      );
    },
    [session, alert, presence],
  );

  const dismiss = useCallback(() => {
    setAlert(null);
    setAck(null);
  }, []);

  return { connection, presence, alert, ack, lastError, rejectedFrames, decide, dismiss };
}
