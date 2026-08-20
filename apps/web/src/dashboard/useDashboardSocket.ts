import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { STATS_EVENTS } from '@airbond/shared';
import type { StatsSnapshot } from '@airbond/shared';

const SESSION_KEY = 'airbond-dashboard-code';

export function useDashboardSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [code, setCode] = useState<string>(() => sessionStorage.getItem(SESSION_KEY) ?? '');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Lazily seeded from whether we have a remembered code to try - avoids a
  // synchronous setState(true) from inside the mount effect below.
  const [connecting, setConnecting] = useState<boolean>(() => !!sessionStorage.getItem(SESSION_KEY));
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);

  // Opens the socket and wires up listeners. All state updates here happen
  // inside async socket event callbacks, never synchronously in the caller -
  // so this is safe to call directly from an effect body.
  function establishConnection(candidateCode: string) {
    socketRef.current?.disconnect();

    const baseUrl = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';
    const socket = io(`${baseUrl}/stats`, {
      transports: ['websocket'],
      auth: { code: candidateCode },
    });
    socketRef.current = socket;

    socket.on(STATS_EVENTS.SNAPSHOT, (data: StatsSnapshot) => {
      setSnapshot(data);
      setAuthenticated(true);
      setConnecting(false);
      sessionStorage.setItem(SESSION_KEY, candidateCode);
    });

    socket.on(STATS_EVENTS.AUTH_ERROR, () => {
      setAuthError('Incorrect passcode.');
      setAuthenticated(false);
      setConnecting(false);
      sessionStorage.removeItem(SESSION_KEY);
    });

    socket.on('connect_error', () => {
      setConnecting(false);
    });

    socket.on('disconnect', () => {
      setAuthenticated(false);
    });
  }

  // Auto-connect once if a previously-successful code is remembered for this tab.
  useEffect(() => {
    if (code) establishConnection(code);
    return () => {
      socketRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  const submitCode = (candidateCode: string) => {
    setCode(candidateCode);
    setAuthError(null);
    setConnecting(true);
    setAuthenticated(false);
    establishConnection(candidateCode);
  };

  const signOut = () => {
    socketRef.current?.disconnect();
    sessionStorage.removeItem(SESSION_KEY);
    setAuthenticated(false);
    setSnapshot(null);
    setCode('');
  };

  return { authenticated, authError, connecting, snapshot, submitCode, signOut };
}
