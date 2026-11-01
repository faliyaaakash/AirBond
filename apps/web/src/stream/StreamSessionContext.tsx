import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStreamSession } from './useStreamSession';

type StreamSession = ReturnType<typeof useStreamSession>;

export interface StreamSessionContextValue extends StreamSession {
  // Lets a room page claim the single persistent <video> element into its own
  // layout (pass its own container div), or release it back to the provider's
  // hidden holder on unmount (pass null) - see the module doc comment below.
  registerVideoContainer: (node: HTMLDivElement | null) => void;
  requestPip: () => void;
  isPipSupported: boolean;
  isInPictureInPicture: boolean;
  // Viewer-only playback volume (broadcaster's own preview is always muted).
  volume: number;
  setVolume: (volume: number) => void;
  // Viewer-only: starts true (see StreamSessionProvider), cleared by unmute().
  viewerMuted: boolean;
  unmute: () => void;
  // True if the browser refused autoplay (e.g. blocked despite starting
  // muted) - resumePlayback() retries play() from a user-gesture handler.
  playbackBlocked: boolean;
  resumePlayback: () => void;
}

const StreamSessionContext = createContext<StreamSessionContextValue | null>(null);

export function useStreamSessionContext(): StreamSessionContextValue {
  const ctx = useContext(StreamSessionContext);
  if (!ctx) {
    throw new Error('useStreamSessionContext must be used within a StreamSessionProvider');
  }
  return ctx;
}

// Hosts ONE useStreamSession() for the whole app's lifetime, above the
// router, so navigating to Home/Chat/Files/Dashboard while live no longer
// tears down the socket/peer connections the way it would if the hook lived
// inside StreamPage.
//
// The video element itself has to live up here too: native Picture-in-Picture
// is closed by the browser the instant its source <video> leaves the
// document, so a room page (BroadcastRoom/ViewerRoom) can't own its own video
// element and expect PiP to survive navigating away. Instead there is exactly
// one <video>, rendered via a portal into whichever container is currently
// registered - the active room page's own slot while on /stream/room/:id, or
// this provider's own invisible holder the rest of the time. Moving the
// portal to a new container can make React mount a fresh DOM node rather
// than relocating the old one, so the node itself is tracked in state
// (videoNode) - every effect that binds something to "the video element"
// (srcObject, mute, volume, PiP listeners) keys off that state and re-runs
// whenever the node identity changes, instead of silently binding to a
// stale/discarded node.
export function StreamSessionProvider({ children }: { children: ReactNode }) {
  const session = useStreamSession();
  const { role, localStream, remoteStream } = session;

  // Tracked in state (not just a ref) so that if the DOM node itself is ever
  // replaced - e.g. React remounts the portaled <video> when its target
  // container changes, rather than moving the existing node - every effect
  // below that binds something to "the video element" re-fires against the
  // new node instead of silently binding nothing (which reads as a black
  // screen: a fresh <video> with no srcObject).
  const [videoNode, setVideoNodeState] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenHolderRef = useRef<HTMLDivElement | null>(null);
  const [activeContainer, setActiveContainer] = useState<HTMLDivElement | null>(null);
  const [isInPictureInPicture, setIsInPictureInPicture] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [volume, setVolumeState] = useState(1);
  // Mobile browsers block autoplay of unmuted media unless it's tied to a
  // direct tap - the remote stream arrives asynchronously after WebRTC
  // negotiation, well after any click, so viewers start muted (which always
  // autoplays) and unmute on an explicit user gesture instead.
  const [viewerMuted, setViewerMuted] = useState(true);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  const setVideoRef = (node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoNodeState(node);
  };

  useEffect(() => {
    setIsPipSupported(typeof document !== 'undefined' && document.pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    if (!videoNode) return;
    const stream = role === 'broadcaster' ? localStream : role === 'viewer' ? remoteStream : null;
    if (videoNode.srcObject !== stream) {
      videoNode.srcObject = stream;
    }
    // Broadcaster's own preview is always muted (avoid local echo); viewer
    // starts muted too (see viewerMuted above) until they explicitly unmute.
    videoNode.muted = role === 'broadcaster' ? true : viewerMuted;
    if (stream) {
      videoNode
        .play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }
  }, [videoNode, role, localStream, remoteStream, viewerMuted]);

  const unmute = () => setViewerMuted(false);
  const resumePlayback = () => {
    videoRef.current
      ?.play()
      .then(() => setPlaybackBlocked(false))
      .catch(() => setPlaybackBlocked(true));
  };

  useEffect(() => {
    if (!videoNode) return;
    const onEnter = () => setIsInPictureInPicture(true);
    const onLeave = () => setIsInPictureInPicture(false);
    videoNode.addEventListener('enterpictureinpicture', onEnter);
    videoNode.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      videoNode.removeEventListener('enterpictureinpicture', onEnter);
      videoNode.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [videoNode]);

  useEffect(() => {
    if (videoNode) videoNode.volume = volume;
  }, [videoNode, volume]);

  const registerVideoContainer = (node: HTMLDivElement | null) => {
    setActiveContainer(node ?? hiddenHolderRef.current);
  };

  const setVolume = (next: number) => setVolumeState(Math.min(1, Math.max(0, next)));

  const requestPip = () => {
    const video = videoRef.current;
    if (!video || !isPipSupported || video.disablePictureInPicture || video.readyState === 0) return;
    void video.requestPictureInPicture().catch(() => {
      // Refused (missing user gesture, unsupported state, etc.) - fail silently,
      // the pop-out button just has no visible effect rather than an error toast.
    });
  };

  const portalTarget = activeContainer ?? hiddenHolderRef.current;

  const value: StreamSessionContextValue = {
    ...session,
    registerVideoContainer,
    requestPip,
    isPipSupported,
    isInPictureInPicture,
    volume,
    setVolume,
    viewerMuted,
    unmute,
    playbackBlocked,
    resumePlayback,
  };

  return (
    <StreamSessionContext.Provider value={value}>
      {children}
      <div
        ref={hiddenHolderRef}
        style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
      />
      {portalTarget &&
        createPortal(
          <video ref={setVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />,
          portalTarget,
        )}
    </StreamSessionContext.Provider>
  );
}
