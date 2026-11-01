import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStreamSessionContext } from './StreamSessionContext';
import { randomStageName } from '../chat/randomStageName';
import StreamLanding from './StreamLanding';
import BroadcastRoom from './BroadcastRoom';
import ViewerRoom from './ViewerRoom';

const ENDED_REASON_MESSAGES: Record<string, string> = {
  ENDED_BY_BROADCASTER: 'That stream has ended.',
  BROADCASTER_LEFT: 'The broadcaster disconnected, so the stream ended.',
  EXPIRED: 'That stream expired after 2 hours.',
};

export default function StreamPage() {
  const { roomId: roomIdFromUrl } = useParams<{ roomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = useStreamSessionContext();
  const { role, roomId, endedReason, kickedReason, dismissEndedOrKicked, joinStream, isSocketConnected } = session;

  const streamIdParam = searchParams.get('streamid');
  const passkeyParam = searchParams.get('passkey');
  const nameParam = searchParams.get('name');
  const autoJoinAttempted = useRef(false);
  // Remembered even after the query params are stripped from the URL, so a
  // failed auto-join (e.g. wrong passkey) still pre-fills the join-by-code
  // form for a manual retry.
  const attemptedRoomIdRef = useRef<string | undefined>(undefined);

  // Deep-link join: ?streamid=&passkey=&name= joins straight away, no need
  // to touch the landing page form at all. Waits for the socket to actually
  // be connected first - on a fresh page load this effect can otherwise fire
  // before the provider's own connect effect (child effects run before
  // ancestor effects on initial mount), which would silently no-op the emit.
  useEffect(() => {
    if (!streamIdParam || autoJoinAttempted.current || role !== 'none' || !isSocketConnected) return;
    autoJoinAttempted.current = true;
    attemptedRoomIdRef.current = streamIdParam;
    dismissEndedOrKicked();
    joinStream(streamIdParam, nameParam?.trim() || randomStageName(), passkeyParam || undefined, 'link');
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamIdParam, passkeyParam, nameParam, role, isSocketConnected]);

  // Keep the URL pointed at the active room once broadcasting/viewing, so
  // it's shareable/bookmarkable - same pattern as File Share and Chat.
  useEffect(() => {
    if (role !== 'none' && roomId && roomId !== roomIdFromUrl) {
      navigate(`/stream/room/${roomId}`, { replace: true });
    }
    if (role === 'none' && roomIdFromUrl && !endedReason && !kickedReason) {
      // Landed back on the discovery view without an active room - drop the
      // stale room ID from the URL (e.g. after "Leave").
      navigate('/stream', { replace: true });
    }
  }, [role, roomId, roomIdFromUrl, endedReason, kickedReason, navigate]);

  const handleLeave = () => navigate('/stream', { replace: true });

  if (role === 'broadcaster') {
    return <BroadcastRoom session={session} onLeave={handleLeave} />;
  }
  if (role === 'viewer') {
    return <ViewerRoom session={session} onLeave={handleLeave} />;
  }

  const notice = endedReason
    ? ENDED_REASON_MESSAGES[endedReason] ?? 'That stream has ended.'
    : kickedReason
      ? 'You were removed from that stream by the broadcaster.'
      : null;

  return (
    <StreamLanding
      streams={session.streams}
      isSocketConnected={session.isSocketConnected}
      creating={session.creating}
      joining={session.joining}
      joinError={session.joinError}
      mediaError={session.mediaError}
      notice={notice}
      initialRoomId={roomIdFromUrl ?? attemptedRoomIdRef.current}
      onCreateStream={(title, isPrivate, password) => {
        dismissEndedOrKicked();
        void session.createStream(title, isPrivate, password);
      }}
      onJoinStream={(id, displayName, password, joinSource) => {
        dismissEndedOrKicked();
        session.joinStream(id, displayName, password, joinSource);
      }}
    />
  );
}
