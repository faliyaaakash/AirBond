import { theme } from '../theme';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import StreamChatPanel from './StreamChatPanel';
import StreamStage from './StreamStage';
import StreamSettingsPanel from './StreamSettingsPanel';
import StreamStatsPanel from './StreamStatsPanel';
import type { StreamSessionContextValue } from './StreamSessionContext';

interface ViewerRoomProps {
  session: StreamSessionContextValue;
  onLeave: () => void;
}

export default function ViewerRoom({ session, onLeave }: ViewerRoomProps) {
  const {
    roomId,
    viewerCount,
    micEnabled,
    cameraEnabled,
    videoSource,
    captionsVisible,
    finalCaption,
    interimCaption,
    chatMessages,
    reactionBursts,
    streamStartedAt,
    viewerConnectionType,
    sendChatMessage,
    sendReaction,
    toggleCaptionsVisible,
    leaveStream,
  } = session;

  const handleLeave = () => {
    leaveStream();
    onLeave();
  };

  // Shared between the normal-mode row below the video and the fullscreen
  // toolbar - only one is ever actually visible at a time (the browser hides
  // everything outside the fullscreened stage while fullscreen is active).
  const mediaControls = (
    <Button variant="secondary" onClick={toggleCaptionsVisible} style={{ padding: '8px 16px', fontSize: 13 }}>
      {captionsVisible ? 'Hide captions' : 'Show captions'}
    </Button>
  );

  const fullscreenControls = (
    <>
      {mediaControls}
      <Button variant="secondary" onClick={handleLeave} style={{ padding: '8px 16px', fontSize: 13 }}>
        Leave
      </Button>
    </>
  );

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <code style={{ fontSize: 14 }}>{roomId}</code>
          <Badge tone="success">{viewerCount} watching</Badge>
          {!micEnabled && <Badge tone="neutral">🔇 Broadcaster muted</Badge>}
          {videoSource === 'screen' && <Badge tone="accent">🖥 Sharing screen</Badge>}
        </div>
        <Button variant="secondary" onClick={handleLeave} style={{ padding: '8px 18px', fontSize: 13 }}>
          Leave
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 480px', minWidth: 0 }}>
          <StreamStage
            cameraEnabled={cameraEnabled}
            cameraOffLabel="Camera is off"
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
                role="viewer"
                captionsSupported={false}
                captionsVisible={captionsVisible}
                onToggleCaptions={toggleCaptionsVisible}
              />
            }
            stats={
              <StreamStatsPanel
                role="viewer"
                streamStartedAt={streamStartedAt}
                viewerCount={viewerCount}
                micEnabled={micEnabled}
                cameraEnabled={cameraEnabled}
                videoSource={videoSource}
                viewerConnectionType={viewerConnectionType}
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

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{mediaControls}</div>
        </div>

        <StreamChatPanel messages={chatMessages} onSend={sendChatMessage} onReact={sendReaction} reactionBursts={reactionBursts} />
      </div>

      <Card style={{ marginTop: 16, background: theme.color.panelAlt }}>
        <p style={{ fontSize: 12, color: theme.color.textSecondary, margin: 0 }}>
          Video and audio stream directly from the broadcaster's browser to yours over WebRTC — this
          server only relays the connection setup, captions, and chat text.
        </p>
      </Card>
    </div>
  );
}
