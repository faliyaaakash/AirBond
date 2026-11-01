import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallSession } from './useCallSession';
import { theme } from '../theme';
import Badge from '../components/Badge';
import Card from '../components/Card';
import Button from '../components/Button';
import CopyButton from '../components/CopyButton';
import PermissionDeniedHelp from '../components/PermissionDeniedHelp';
import { isLikelyIOS } from '../stream/mediaError';

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  fontSize: 14,
  fontFamily: theme.font.body,
};

const CALL_ENDED_MESSAGES: Record<string, string> = {
  PEER_LEFT: 'The other person left the call.',
  EXPIRED: 'This call reached its 2-hour limit and was closed.',
};

export default function CallPage() {
  const { roomId: roomIdFromUrl } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    isSocketConnected,
    role,
    roomId,
    creating,
    joining,
    joinError,
    mediaError,
    endedReason,
    connectionType,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    remoteMicEnabled,
    remoteCameraEnabled,
    createCall,
    joinCall,
    leaveCall,
    toggleMic,
    toggleCamera,
  } = useCallSession();

  const [joinInput, setJoinInput] = useState(roomIdFromUrl ?? '');
  const autoJoinAttempted = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Mobile browsers (iOS Safari in particular) refuse to autoplay a <video>
  // with sound unless it's muted or play() runs inside a direct user
  // gesture - the remote track arrives asynchronously after WebRTC
  // negotiation, well after the Start/Join tap, so this starts muted (which
  // always autoplays) and the overlay below lets the person unmute
  // explicitly. Without this, a blocked autoplay reads as a black screen
  // with no error anywhere.
  const [remoteMuted, setRemoteMuted] = useState(true);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  // Visiting /call/room/:roomId directly (e.g. a shared link) auto-joins
  // that room once the signaling socket is up. autoJoinAttempted is set
  // unconditionally the first time this runs (not only when it decides to
  // actually join) - creating/joining updates the URL via the effect below,
  // which flips roomIdFromUrl from undefined to a value on this SAME mount,
  // and a call ending later resets `roomId` back to '' on the same mount
  // too. Either change re-evaluates this effect; setting the flag up front
  // makes it a true "did this effect's decision ever run" latch instead of
  // one only a successful join trips, so a stale roomIdFromUrl can't cause a
  // second join attempt against a room that's already gone.
  useEffect(() => {
    if (!roomIdFromUrl || autoJoinAttempted.current || !isSocketConnected) return;
    autoJoinAttempted.current = true;
    if (roomId) return; // already in a room from our own create/join, not a fresh deep link
    // remoteMuted/playbackBlocked are already at their mount-time defaults
    // here (nothing has toggled them yet), so no reset needed before this
    // first join - see handleJoinCall for the reset used on every later one.
    void joinCall(roomIdFromUrl);
  }, [roomIdFromUrl, isSocketConnected, joinCall, roomId]);

  useEffect(() => {
    if (roomId && roomId !== roomIdFromUrl) {
      navigate(`/call/room/${roomId}`, { replace: true });
    }
  }, [roomId, roomIdFromUrl, navigate]);

  // Always muted (avoid local echo), but still drive play() explicitly -
  // relying on the `autoPlay` attribute alone can silently no-op in some
  // mobile in-app browsers/webviews when srcObject is assigned after mount.
  const hydrateLocalVideo = (video: HTMLVideoElement | null) => {
    localVideoRef.current = video;
    if (!video || !localStream) return;
    if (video.srcObject !== localStream) video.srcObject = localStream;
    void video.play().catch(() => {});
  };

  useEffect(() => {
    // Covers the stream arriving/changing while the <video> is already
    // mounted. The camera-off toggle below unmounts and later remounts this
    // same <video> element entirely (it doesn't just hide it) without
    // localStream's reference ever changing, so hydrateLocalVideo (the ref
    // callback) is what re-attaches srcObject on that remount - this effect
    // alone would miss it.
    hydrateLocalVideo(localVideoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    if (video.srcObject !== remoteStream) video.srcObject = remoteStream;
    video.muted = remoteMuted;
    if (remoteStream) {
      video
        .play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }
  }, [remoteStream, remoteMuted]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen();
    }
  };

  const resumeRemotePlayback = () => {
    setRemoteMuted(false);
    remoteVideoRef.current
      ?.play()
      .then(() => setPlaybackBlocked(false))
      .catch(() => setPlaybackBlocked(true));
  };

  // Reset at the start of each call (not just on leave) so a previous call's
  // unmute doesn't carry over to a new remote stream that may hit the same
  // autoplay block again - these run from direct click handlers, not an
  // effect, so resetting here is a plain state update, not a cascading one.
  const handleCreateCall = () => {
    setRemoteMuted(true);
    setPlaybackBlocked(false);
    void createCall();
  };

  const handleJoinCall = (targetRoomId: string) => {
    setRemoteMuted(true);
    setPlaybackBlocked(false);
    void joinCall(targetRoomId);
  };

  const handleLeave = () => {
    leaveCall();
    navigate('/call');
  };

  const inCall = role !== 'none';

  // Shared between the normal-mode row below the video and the fullscreen
  // bottom bar - only one is ever actually visible at a time (the browser
  // hides everything outside the fullscreened stage while fullscreen is
  // active), same pattern as the live-stream feature's controls.
  const callControls = (
    <>
      <Button variant="secondary" onClick={toggleMic}>
        {micEnabled ? '🎙 Mute' : '🔇 Unmute'}
      </Button>
      <Button variant="secondary" onClick={toggleCamera}>
        {cameraEnabled ? '📷 Turn camera off' : '📷 Turn camera on'}
      </Button>
      <Button
        variant="secondary"
        onClick={handleLeave}
        style={{ color: theme.color.danger, borderColor: theme.color.danger }}
      >
        Leave call
      </Button>
    </>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 30 }}>Video Call</h1>
        <Badge tone={isSocketConnected ? 'success' : 'neutral'} dot>
          {isSocketConnected ? 'Signaling connected' : 'Signaling offline'}
        </Badge>
      </div>
      <p style={{ color: theme.color.textSecondary, fontSize: 14, marginTop: 6 }}>
        A private, 1:1 video call between exactly two people - no accounts, nothing recorded or stored. Create a
        call and share the link, or join one you were sent.
      </p>

      {mediaError && (
        <Card style={{ marginTop: 16, borderColor: theme.color.danger }}>
          <p style={{ fontSize: 13, color: theme.color.danger, margin: 0 }}>{mediaError.message}</p>
          {mediaError.code === 'insecure-context' && isLikelyIOS() && (
            <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
              iOS has no setting to allow camera access over plain HTTP - use an HTTPS link instead.
            </p>
          )}
          {mediaError.code === 'permission-denied' && <PermissionDeniedHelp />}
        </Card>
      )}

      {endedReason && !inCall && (
        <Card style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, margin: 0 }}>{CALL_ENDED_MESSAGES[endedReason] ?? 'The call ended.'}</p>
        </Card>
      )}

      {joinError && (
        <Card style={{ marginTop: 16, borderColor: theme.color.danger }}>
          <p style={{ fontSize: 13, color: theme.color.danger, margin: 0 }}>{joinError.message}</p>
        </Card>
      )}

      {!inCall ? (
        <div style={{ display: 'flex', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
          <Card style={{ flex: '1 1 260px' }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Start a call</h3>
            <Button onClick={handleCreateCall} disabled={!isSocketConnected || creating}>
              {creating ? 'Starting…' : 'Start call'}
            </Button>
          </Card>
          <Card style={{ flex: '1 1 260px' }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Join a call</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="Call ID"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
              />
              <Button variant="secondary" onClick={() => handleJoinCall(joinInput)} disabled={!isSocketConnected || joining}>
                {joining ? 'Joining…' : 'Join'}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <>
          <Card style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: theme.color.textSecondary }}>Call ID:</span>
                <code style={{ fontSize: 14 }}>{roomId}</code>
                <CopyButton value={roomId} label="Copy" />
                <CopyButton value={`${window.location.origin}/call/room/${roomId}`} label="Copy invite link" />
              </div>
              <Badge tone={remoteStream ? 'success' : 'neutral'} dot>
                {remoteStream ? `Connected${connectionType !== 'unknown' ? ` · ${connectionType}` : ''}` : 'Waiting for the other person…'}
              </Badge>
            </div>
          </Card>

          <div
            ref={stageRef}
            style={{
              position: 'relative',
              marginTop: isFullscreen ? 0 : 16,
              background: '#111',
              borderRadius: isFullscreen ? 0 : theme.radius.md,
              overflow: 'hidden',
              aspectRatio: isFullscreen ? undefined : '16 / 9',
              width: '100%',
              height: isFullscreen ? '100%' : undefined,
            }}
          >
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 14,
                }}
              >
                Waiting for the other person to join…
              </div>
            )}
            {remoteStream && !remoteCameraEnabled && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#111',
                  color: '#fff',
                  fontSize: 14,
                }}
              >
                Camera is off
              </div>
            )}
            {remoteStream && !remoteMicEnabled && (
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <Badge tone="neutral">🔇 Muted</Badge>
              </div>
            )}

            {remoteStream && (remoteMuted || playbackBlocked) && (
              <button
                type="button"
                onClick={resumeRemotePlayback}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'rgba(0,0,0,0.35)',
                  border: 'none',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {playbackBlocked ? '▶ Tap to play' : '🔇 Tap to unmute'}
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {isFullscreen ? '⤡' : '⤢'}
            </button>

            <div
              style={{
                position: 'absolute',
                bottom: isFullscreen ? 86 : 12,
                right: 12,
                width: 140,
                aspectRatio: '16 / 9',
                borderRadius: theme.radius.sm,
                overflow: 'hidden',
                border: '2px solid rgba(255,255,255,0.5)',
                background: '#000',
              }}
            >
              {cameraEnabled ? (
                <video
                  ref={hydrateLocalVideo}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 11,
                  }}
                >
                  Camera off
                </div>
              )}
            </div>

            {isFullscreen && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  padding: '14px 16px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)',
                }}
              >
                {callControls}
              </div>
            )}
          </div>

          {!isFullscreen && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {callControls}
            </div>
          )}

          <Card style={{ marginTop: 16, background: theme.color.panelAlt }}>
            <p style={{ fontSize: 12, color: theme.color.textSecondary, margin: 0 }}>
              Video and audio stream directly between your two browsers over WebRTC - this server only relays the
              connection setup, nothing else.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
