import { theme } from '../theme';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import CopyButton from '../components/CopyButton';
import StreamChatPanel from './StreamChatPanel';
import StreamStage from './StreamStage';
import StreamSettingsPanel from './StreamSettingsPanel';
import StreamStatsPanel from './StreamStatsPanel';
import type { StreamSessionContextValue } from './StreamSessionContext';
import type { CaptionStatus } from './speechRecognition';

const CAPTION_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Captions need microphone access - check your browser permission for this site.',
  'service-not-allowed': "Captions can't reach the speech service - check your internet connection.",
  'audio-capture': 'No microphone detected for captions.',
  'language-not-supported': "Captions aren't supported for this language.",
  network: 'Captions are having trouble reaching the speech service - retrying…',
  'no-speech': 'Listening for captions…',
};

function describeCaptionStatus(status: CaptionStatus): string {
  const detail = CAPTION_ERROR_MESSAGES[status.reason];
  if (status.state === 'stopped') {
    return detail ?? `Captions stopped (${status.reason}).`;
  }
  return detail ?? 'Captions had a hiccup - retrying…';
}

interface BroadcastRoomProps {
  session: StreamSessionContextValue;
  onLeave: () => void;
}

const smallBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13 };

export default function BroadcastRoom({ session, onLeave }: BroadcastRoomProps) {
  const {
    roomId,
    viewerCount,
    micEnabled,
    cameraEnabled,
    videoSource,
    createdPassword,
    captionsSupported,
    captionsVisible,
    captionStatus,
    finalCaption,
    interimCaption,
    chatMessages,
    reactionBursts,
    viewers,
    streamStartedAt,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleCaptionsVisible,
    sendChatMessage,
    sendReaction,
    kickViewer,
    endStream,
  } = session;

  const handleEndStream = () => {
    endStream();
    onLeave();
  };

  const inviteLink = `${window.location.origin}/stream?streamid=${roomId}${
    createdPassword ? `&passkey=${encodeURIComponent(createdPassword)}` : ''
  }`;

  // Shared between the normal-mode row below the video and the fullscreen
  // toolbar - only one is ever actually visible at a time (the browser hides
  // everything outside the fullscreened stage while fullscreen is active).
  const mediaControls = (
    <>
      <Button variant="secondary" onClick={toggleMic} style={smallBtn}>
        {micEnabled ? '🎤 Mute' : '🔇 Unmute'}
      </Button>
      <Button variant="secondary" onClick={toggleCamera} style={smallBtn}>
        {cameraEnabled ? '📷 Camera off' : '📷 Camera on'}
      </Button>
      <Button variant="secondary" onClick={toggleScreenShare} style={smallBtn}>
        {videoSource === 'screen' ? '🖥 Stop sharing' : '🖥 Share screen'}
      </Button>
    </>
  );

  const fullscreenControls = (
    <>
      {mediaControls}
      <Button
        variant="secondary"
        onClick={handleEndStream}
        style={{ ...smallBtn, color: theme.color.danger, borderColor: theme.color.danger }}
      >
        ⏹ End stream
      </Button>
    </>
  );

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: theme.color.textSecondary }}>Room ID:</span>
          <code style={{ fontSize: 14 }}>{roomId}</code>
          <CopyButton value={roomId} label="Copy" />
          <CopyButton value={inviteLink} label="Copy invite link" />
          <Badge tone="success">{viewerCount} watching</Badge>
        </div>
        <Button
          variant="secondary"
          onClick={handleEndStream}
          style={{ padding: '8px 18px', fontSize: 13, color: theme.color.danger, borderColor: theme.color.danger }}
        >
          End stream
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 480px', minWidth: 0 }}>
          <StreamStage
            cameraEnabled={cameraEnabled}
            cameraOffLabel="Camera off"
            topLeftBadges={videoSource === 'screen' ? <Badge tone="accent">🖥 Sharing screen</Badge> : undefined}
            finalCaption={finalCaption}
            interimCaption={interimCaption}
            captionsVisible={captionsVisible}
            roomLabel={
              <>
                <Badge tone="success">{viewerCount} watching</Badge>
                <code style={{ fontSize: 12, color: '#fff' }}>{roomId}</code>
              </>
            }
            controls={fullscreenControls}
            settings={
              <StreamSettingsPanel
                role="broadcaster"
                captionsSupported={captionsSupported}
                captionsVisible={captionsVisible}
                onToggleCaptions={toggleCaptionsVisible}
              />
            }
            stats={
              <StreamStatsPanel
                role="broadcaster"
                streamStartedAt={streamStartedAt}
                viewerCount={viewerCount}
                micEnabled={micEnabled}
                cameraEnabled={cameraEnabled}
                videoSource={videoSource}
                viewerConnectionType="unknown"
              />
            }
            chat={
              <StreamChatPanel
                messages={chatMessages}
                onSend={sendChatMessage}
                onReact={sendReaction}
                reactionBursts={reactionBursts}
              />
            }
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {mediaControls}
            {captionsSupported && (
              <Button variant="secondary" onClick={toggleCaptionsVisible} style={{ padding: '8px 16px', fontSize: 13 }}>
                {captionsVisible ? 'Hide captions' : 'Show captions'}
              </Button>
            )}
          </div>
          {!captionsSupported && (
            <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 8 }}>
              Live captions aren't supported in this browser — try Chrome or Edge.
            </p>
          )}
          {captionsSupported && captionStatus && (
            <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 8 }}>
              {describeCaptionStatus(captionStatus)}
            </p>
          )}

          <Card style={{ marginTop: 16 }} padded={false}>
            <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: theme.color.textSecondary }}>
              VIEWERS · {viewers.length}
            </div>
            {viewers.length === 0 ? (
              <p style={{ padding: '0 14px 14px', fontSize: 13, color: theme.color.textSecondary }}>
                Waiting for viewers to join.
              </p>
            ) : (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {viewers.map((viewer) => (
                  <div key={viewer.peerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>{viewer.displayName}</span>
                    <button
                      onClick={() => kickViewer(viewer.peerId)}
                      style={{ border: 'none', background: 'transparent', color: theme.color.danger, fontSize: 12, cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <StreamChatPanel messages={chatMessages} onSend={sendChatMessage} onReact={sendReaction} reactionBursts={reactionBursts} />
      </div>
    </div>
  );
}
