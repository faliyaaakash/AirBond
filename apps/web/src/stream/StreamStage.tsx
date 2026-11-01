import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { theme } from '../theme';
import CaptionOverlay from './CaptionOverlay';
import { useStreamSessionContext } from './StreamSessionContext';

const CONTROLS_IDLE_HIDE_MS = 3000;

type FullscreenPanel = 'chat' | 'settings' | 'stats' | null;

interface StreamStageProps {
  cameraEnabled: boolean;
  cameraOffLabel: string;
  topLeftBadges?: ReactNode;
  finalCaption: string;
  interimCaption: string;
  captionsVisible: boolean;
  // Small info shown in the fullscreen top bar (room id / viewer count badges).
  roomLabel: ReactNode;
  // Primary action buttons (mic/camera/screen for broadcaster; volume/leave
  // for viewer) - rendered in the fullscreen bottom toolbar.
  controls: ReactNode;
  settings: ReactNode;
  stats: ReactNode;
  chat: ReactNode;
}

// Shared video stage for BroadcastRoom/ViewerRoom. Outside fullscreen it's
// just the video box (the room page keeps its own controls/chat layout
// around it, unchanged). In fullscreen it also renders a YouTube/Twitch-style
// overlay: an auto-hiding bottom toolbar plus three independently
// toggleable panels (Chat/Settings/Stats) - "Controls" is the toolbar itself.
export default function StreamStage({
  cameraEnabled,
  cameraOffLabel,
  topLeftBadges,
  finalCaption,
  interimCaption,
  captionsVisible,
  roomLabel,
  controls,
  settings,
  stats,
  chat,
}: StreamStageProps) {
  const {
    registerVideoContainer,
    requestPip,
    isPipSupported,
    isInPictureInPicture,
    role,
    viewerMuted,
    unmute,
    playbackBlocked,
    resumePlayback,
  } = useStreamSessionContext();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState<FullscreenPanel>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);

  // The fullscreen toolbar wraps onto extra rows on narrow screens (mobile),
  // so its height isn't a fixed constant - measure it live so captions can
  // stack above it instead of overlapping the mic/camera/leave buttons.
  useEffect(() => {
    if (!isFullscreen) {
      setBottomBarHeight(0);
      return;
    }
    const el = bottomBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBottomBarHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFullscreen]);

  // Claim the single persistent video element (see StreamSessionContext) into
  // this stage's own box; release it back to the provider's hidden holder on
  // unmount so playback/PiP keep going if the user navigates away.
  useEffect(() => {
    registerVideoContainer(videoContainerRef.current);
    return () => registerVideoContainer(null);
  }, [registerVideoContainer]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      return;
    }
    const resetIdleTimer = () => {
      setControlsVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_HIDE_MS);
    };
    resetIdleTimer();
    const stage = stageRef.current;
    stage?.addEventListener('mousemove', resetIdleTimer);
    stage?.addEventListener('mousedown', resetIdleTimer);
    return () => {
      stage?.removeEventListener('mousemove', resetIdleTimer);
      stage?.removeEventListener('mousedown', resetIdleTimer);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen();
    }
  };

  const togglePanel = (panel: Exclude<FullscreenPanel, null>) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  return (
    <div
      ref={stageRef}
      style={{
        position: 'relative',
        background: '#111',
        borderRadius: isFullscreen ? 0 : theme.radius.md,
        overflow: 'hidden',
        aspectRatio: isFullscreen ? undefined : '16 / 9',
        width: '100%',
        height: isFullscreen ? '100%' : undefined,
      }}
    >
      <div ref={videoContainerRef} style={{ position: 'absolute', inset: 0 }} />

      {role === 'viewer' && (viewerMuted || playbackBlocked) && (
        <button
          type="button"
          onClick={() => {
            unmute();
            resumePlayback();
          }}
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

      {!cameraEnabled && (
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
          {cameraOffLabel}
        </div>
      )}

      {topLeftBadges && <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>{topLeftBadges}</div>}

      <CaptionOverlay
        finalCaption={finalCaption}
        interimCaption={interimCaption}
        visible={captionsVisible}
        bottomOffset={isFullscreen ? bottomBarHeight + 12 : 16}
      />

      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          display: 'flex',
          gap: 6,
          opacity: !isFullscreen || controlsVisible ? 1 : 0,
          transition: 'opacity 0.2s',
        }}
      >
        {isPipSupported && (
          <StageIconButton onClick={requestPip} active={isInPictureInPicture} label="Picture-in-picture" icon="⧉" />
        )}
        <StageIconButton
          onClick={toggleFullscreen}
          active={isFullscreen}
          label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          icon={isFullscreen ? '⤡' : '⤢'}
        />
      </div>

      {isFullscreen && (
        <>
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              opacity: controlsVisible ? 1 : 0,
              transition: 'opacity 0.2s',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {roomLabel}
          </div>

          {activePanel === 'chat' && (
            <FullscreenDrawer title="Chat" onClose={() => setActivePanel(null)}>
              {chat}
            </FullscreenDrawer>
          )}
          {activePanel === 'settings' && (
            <FullscreenDrawer title="Settings" onClose={() => setActivePanel(null)}>
              {settings}
            </FullscreenDrawer>
          )}
          {activePanel === 'stats' && (
            <FullscreenDrawer title="Stats" onClose={() => setActivePanel(null)}>
              {stats}
            </FullscreenDrawer>
          )}

          <div
            ref={bottomBarRef}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '14px 16px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)',
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.2s, transform 0.2s',
              pointerEvents: controlsVisible ? 'auto' : 'none',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{controls}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StageIconButton onClick={() => togglePanel('chat')} active={activePanel === 'chat'} label="Chat" icon="💬" />
              <StageIconButton onClick={() => togglePanel('settings')} active={activePanel === 'settings'} label="Settings" icon="⚙" />
              <StageIconButton onClick={() => togglePanel('stats')} active={activePanel === 'stats'} label="Stats" icon="📊" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StageIconButton({
  onClick,
  active,
  label,
  icon,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: 'none',
        background: active ? theme.color.accent : 'rgba(0,0,0,0.55)',
        color: '#fff',
        fontSize: 16,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}

function FullscreenDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        right: 10,
        bottom: 78,
        width: 300,
        maxWidth: 'calc(100% - 20px)',
        background: theme.color.panel,
        borderRadius: theme.radius.md,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: `1px solid ${theme.color.border}`,
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          style={{ border: 'none', background: 'transparent', fontSize: 16, cursor: 'pointer', color: theme.color.textSecondary }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{children}</div>
    </div>
  );
}
