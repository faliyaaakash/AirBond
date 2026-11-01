import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { STREAM_EVENTS } from '@airbond/shared';
import type {
  CaptionPayload,
  CreateStreamPayload,
  NewReactionPayload,
  NewStreamMessagePayload,
  StreamCreatedPayload,
  StreamEndedPayload,
  StreamJoinErrorPayload,
  StreamJoinedPayload,
  StreamJoinSource,
  StreamKickedPayload,
  StreamSummary,
  TrackStatePayload,
  VideoSource,
  ViewerCountPayload,
  ViewerJoinedPayload,
  ViewerLeftPayload,
} from '@airbond/shared';
import { ICE_CONFIG } from '../webrtc/iceConfig';
import { classifyConnectionType, type ConnectionType } from '../webrtc/connectionType';
import { isCaptionsSupported, startCaptionRecognition, type CaptionStatus } from './speechRecognition';
import { classifyMediaErrorAsync, type MediaErrorInfo } from './mediaError';

const INTERIM_CAPTION_THROTTLE_MS = 300;
const REACTION_BURST_LIFETIME_MS = 2000;

export type StreamRole = 'none' | 'broadcaster' | 'viewer';

export interface StreamViewer {
  peerId: string;
  displayName: string;
}

export interface ReactionBurst {
  id: string;
  displayName: string;
}

// Single socket for the whole "/stream" namespace session, mirroring
// useChatSocket/usePeerConnection: one hook, one socket, for the page's
// lifetime. Discovery, broadcasting, and viewing all share it rather than
// each opening their own connection (which would otherwise double-count
// this tab in the live lobby once a room is joined).
export function useStreamSession() {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string>('');
  const displayNameRef = useRef<string>('');
  const broadcasterPeerIdRef = useRef<string>('');

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueues = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteDescriptionSet = useRef<Map<string, boolean>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const stopCaptionsRef = useRef<(() => void) | null>(null);
  const lastInterimEmitRef = useRef<number>(0);
  // Broadcaster-only, in-memory: the plaintext password just chosen at
  // creation time, purely so an invite link can embed it. Never sent back by
  // the server (it only ever receives it once, to hash it).
  const createdPasswordRef = useRef<string | undefined>(undefined);

  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [role, setRole] = useState<StreamRole>('none');
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [videoSource, setVideoSource] = useState<VideoSource>('camera');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [captionsSupported, setCaptionsSupported] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  // null while captions are healthy - only set once the recognizer actually
  // struggles, so the UI can tell "no one has spoken yet" from "broken".
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus | null>(null);
  const [finalCaption, setFinalCaption] = useState('');
  const [interimCaption, setInterimCaption] = useState('');
  const [chatMessages, setChatMessages] = useState<NewStreamMessagePayload[]>([]);
  const [reactionBursts, setReactionBursts] = useState<ReactionBurst[]>([]);
  const [viewers, setViewers] = useState<StreamViewer[]>([]);
  const [joinError, setJoinError] = useState<StreamJoinErrorPayload | null>(null);
  const [mediaError, setMediaError] = useState<MediaErrorInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [endedReason, setEndedReason] = useState<StreamEndedPayload['reason'] | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  // When this session's stream started, for the fullscreen Stats panel's
  // elapsed-duration readout.
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  // Viewer-only: this browser's own classification of its peer connection to
  // the broadcaster (direct P2P vs. TURN relay), already computed for the
  // server's dashboard - kept here too so the Stats panel can show it.
  const [viewerConnectionType, setViewerConnectionType] = useState<ConnectionType>('unknown');
  const [createdPassword, setCreatedPassword] = useState<string | undefined>(undefined);

  function closePeer(peerId: string) {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    candidateQueues.current.delete(peerId);
    remoteDescriptionSet.current.delete(peerId);
  }

  function closeAllPeers() {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    candidateQueues.current.clear();
    remoteDescriptionSet.current.clear();
  }

  function stopLocalMedia() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraVideoTrackRef.current = null;
    activeVideoTrackRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
  }

  function resetSessionState() {
    closeAllPeers();
    stopLocalMedia();
    stopCaptionsRef.current?.();
    stopCaptionsRef.current = null;
    roomIdRef.current = '';
    broadcasterPeerIdRef.current = '';
    displayNameRef.current = '';
    createdPasswordRef.current = undefined;
    setRole('none');
    setRoomId('');
    setDisplayName('');
    setViewerCount(0);
    setMicEnabled(true);
    setCameraEnabled(true);
    setVideoSource('camera');
    setRemoteStream(null);
    setFinalCaption('');
    setInterimCaption('');
    setCaptionStatus(null);
    setChatMessages([]);
    setReactionBursts([]);
    setViewers([]);
    setJoining(false);
    setStreamStartedAt(null);
    setViewerConnectionType('unknown');
    setCreatedPassword(undefined);
  }

  async function drainCandidateQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = candidateQueues.current.get(peerId) || [];
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`Error draining ICE candidate for ${peerId}:`, err);
      }
    }
  }

  function createPeerConnection(peerId: string, isViewerReportingConnection: boolean): RTCPeerConnection {
    peersRef.current.get(peerId)?.close();

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current.set(peerId, pc);
    candidateQueues.current.set(peerId, []);
    remoteDescriptionSet.current.set(peerId, false);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit(STREAM_EVENTS.ICE_CANDIDATE, {
          targetPeerId: peerId,
          candidate: event.candidate,
          roomId: roomIdRef.current,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        closePeer(peerId);
        return;
      }
      // Only the viewer reports its own connection - that's the socket ID the
      // dashboard's per-viewer direct/relay breakdown is keyed on.
      if (pc.connectionState === 'connected' && isViewerReportingConnection) {
        void classifyConnectionType(pc).then((connectionType) => {
          setViewerConnectionType(connectionType);
          socketRef.current?.emit(STREAM_EVENTS.CONNECTION_INFO, {
            roomId: roomIdRef.current,
            connectionType,
          });
        });
      }
    };

    return pc;
  }

  function pushReactionBurst(displayName: string) {
    const id = crypto.randomUUID();
    setReactionBursts((prev) => [...prev, { id, displayName }]);
    setTimeout(() => {
      setReactionBursts((prev) => prev.filter((burst) => burst.id !== id));
    }, REACTION_BURST_LIFETIME_MS);
  }

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';
    const socket = io(`${baseUrl}/stream`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('connect_error', () => setIsSocketConnected(false));
    socket.on('disconnect', () => setIsSocketConnected(false));

    socket.on(STREAM_EVENTS.STREAM_LIST, (data: StreamSummary[]) => setStreams(data));

    socket.on(STREAM_EVENTS.STREAM_CREATED, (data: StreamCreatedPayload) => {
      roomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setRole('broadcaster');
      setCreating(false);
      setStreamStartedAt(Date.now());

      const supported = isCaptionsSupported();
      setCaptionsSupported(supported);
      if (supported) {
        setCaptionStatus(null);
        stopCaptionsRef.current = startCaptionRecognition(
          (result) => {
            setCaptionStatus(null);
            if (result.isFinal) {
              setFinalCaption(result.text);
              setInterimCaption('');
              socket.emit(STREAM_EVENTS.CAPTION, {
                roomId: roomIdRef.current,
                text: result.text,
                isFinal: true,
              });
            } else {
              setInterimCaption(result.text);
              const now = Date.now();
              if (now - lastInterimEmitRef.current > INTERIM_CAPTION_THROTTLE_MS) {
                lastInterimEmitRef.current = now;
                socket.emit(STREAM_EVENTS.CAPTION, {
                  roomId: roomIdRef.current,
                  text: result.text,
                  isFinal: false,
                });
              }
            }
          },
          (status) => setCaptionStatus(status),
        );
      }
    });

    socket.on(STREAM_EVENTS.JOIN_ERROR, (data: StreamJoinErrorPayload) => {
      setJoinError(data);
      setCreating(false);
      setJoining(false);
    });

    // --- Broadcaster side: a viewer showed up, initiate the offer ---------
    socket.on(STREAM_EVENTS.VIEWER_JOINED, async (data: ViewerJoinedPayload) => {
      setViewers((prev) => [...prev, { peerId: data.viewerPeerId, displayName: data.displayName }]);

      const pc = createPeerConnection(data.viewerPeerId, false);
      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit(STREAM_EVENTS.SDP_OFFER, {
        targetPeerId: data.viewerPeerId,
        sdp: offer,
        roomId: roomIdRef.current,
      });
    });

    socket.on(STREAM_EVENTS.VIEWER_LEFT, (data: ViewerLeftPayload) => {
      closePeer(data.viewerPeerId);
      setViewers((prev) => prev.filter((v) => v.peerId !== data.viewerPeerId));
    });

    // --- Viewer side: joined, wait for the broadcaster's offer -----------
    socket.on(STREAM_EVENTS.STREAM_JOINED, (data: StreamJoinedPayload) => {
      roomIdRef.current = data.roomId;
      broadcasterPeerIdRef.current = data.broadcasterPeerId;
      setRoomId(data.roomId);
      setRole('viewer');
      setJoining(false);
      setJoinError(null);
      setViewerCount(data.viewerCount);
      setMicEnabled(data.micEnabled);
      setCameraEnabled(data.cameraEnabled);
      setVideoSource(data.videoSource);
      setStreamStartedAt(Date.now());
      createPeerConnection(data.broadcasterPeerId, true);
    });

    socket.on(
      STREAM_EVENTS.SDP_OFFER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        const pc = peersRef.current.get(data.senderPeerId) ?? createPeerConnection(data.senderPeerId, true);

        pc.ontrack = (event) => {
          setRemoteStream((prev) => {
            const stream = prev ?? new MediaStream();
            if (!stream.getTracks().includes(event.track)) {
              stream.addTrack(event.track);
            }
            return prev ? stream : new MediaStream(stream.getTracks());
          });
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSet.current.set(data.senderPeerId, true);
        await drainCandidateQueue(data.senderPeerId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit(STREAM_EVENTS.SDP_ANSWER, {
          targetPeerId: data.senderPeerId,
          sdp: answer,
          roomId: roomIdRef.current,
        });
      },
    );

    socket.on(
      STREAM_EVENTS.SDP_ANSWER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        const pc = peersRef.current.get(data.senderPeerId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSet.current.set(data.senderPeerId, true);
        await drainCandidateQueue(data.senderPeerId, pc);
      },
    );

    socket.on(
      STREAM_EVENTS.ICE_CANDIDATE,
      async (data: { senderPeerId: string; candidate: RTCIceCandidateInit }) => {
        if (!data.candidate) return;
        const pc = peersRef.current.get(data.senderPeerId);
        const isReady = remoteDescriptionSet.current.get(data.senderPeerId);
        if (pc && isReady && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.warn('Error adding ICE candidate:', err);
          }
        } else {
          const queue = candidateQueues.current.get(data.senderPeerId) || [];
          queue.push(data.candidate);
          candidateQueues.current.set(data.senderPeerId, queue);
        }
      },
    );

    socket.on(STREAM_EVENTS.VIEWER_COUNT, (data: ViewerCountPayload) => setViewerCount(data.count));

    socket.on(STREAM_EVENTS.TRACK_STATE, (data: TrackStatePayload) => {
      setMicEnabled(data.micEnabled);
      setCameraEnabled(data.cameraEnabled);
      setVideoSource(data.videoSource);
    });

    socket.on(STREAM_EVENTS.CAPTION, (data: CaptionPayload) => {
      if (data.isFinal) {
        setFinalCaption(data.text);
        setInterimCaption('');
      } else {
        setInterimCaption(data.text);
      }
    });

    socket.on(STREAM_EVENTS.NEW_STREAM_MESSAGE, (data: NewStreamMessagePayload) => {
      setChatMessages((prev) => [...prev, data]);
    });

    socket.on(STREAM_EVENTS.NEW_REACTION, (data: NewReactionPayload) => {
      pushReactionBurst(data.displayName);
    });

    socket.on(STREAM_EVENTS.STREAM_KICKED, (data: StreamKickedPayload) => {
      resetSessionState();
      setKickedReason(data.reason);
    });

    socket.on(STREAM_EVENTS.STREAM_ENDED, (data: StreamEndedPayload) => {
      resetSessionState();
      setEndedReason(data.reason);
    });

    return () => {
      closeAllPeers();
      stopLocalMedia();
      stopCaptionsRef.current?.();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createStream = useCallback(async (title: string, isPrivate: boolean, password?: string) => {
    setJoinError(null);
    setMediaError(null);
    setEndedReason(null);
    setKickedReason(null);

    // getUserMedia is only available in a "secure context" - https://, or
    // http://localhost. Loading this page over plain http:// via a LAN IP
    // (e.g. testing from another device) fails here with no camera prompt
    // at all, which otherwise looks like the button just does nothing. The
    // fix differs by platform (Android Chrome has a flag, iOS has none at
    // all), so the UI layer decides what to say - this just flags the cause.
    if (!window.isSecureContext) {
      setMediaError({
        code: 'insecure-context',
        message:
          'Camera/microphone access requires a secure connection. This page was loaded over ' +
          'plain HTTP at a non-localhost address, which browsers block from using the camera.',
      });
      return;
    }

    setCreating(true);
    displayNameRef.current = 'Host';
    setDisplayName('Host');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      setCreating(false);
      setMediaError(await classifyMediaErrorAsync(err));
      return;
    }

    localStreamRef.current = stream;
    cameraVideoTrackRef.current = stream.getVideoTracks()[0] ?? null;
    activeVideoTrackRef.current = cameraVideoTrackRef.current;
    setLocalStream(stream);
    createdPasswordRef.current = isPrivate ? password : undefined;
    setCreatedPassword(createdPasswordRef.current);

    const payload: CreateStreamPayload = { title, isPrivate, password };
    socketRef.current?.emit(STREAM_EVENTS.CREATE_STREAM, payload);
  }, []);

  const joinStream = useCallback(
    (targetRoomId: string, name: string, password?: string, joinSource: StreamJoinSource = 'code') => {
      setJoinError(null);
      setEndedReason(null);
      setKickedReason(null);
      setJoining(true);
      displayNameRef.current = name.trim();
      setDisplayName(displayNameRef.current);
      socketRef.current?.emit(STREAM_EVENTS.JOIN_STREAM, {
        roomId: targetRoomId.trim(),
        displayName: displayNameRef.current,
        password,
        joinSource,
      });
    },
    [],
  );

  const leaveStream = useCallback(() => {
    resetSessionState();
    // Force a fresh connection so the server's disconnect cleanup runs
    // immediately (frees the viewer slot) instead of waiting for a timeout.
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
    socketRef.current?.emit(STREAM_EVENTS.TRACK_STATE, {
      roomId: roomIdRef.current,
      micEnabled: track.enabled,
      cameraEnabled,
      videoSource,
    });
  }, [cameraEnabled, videoSource]);

  const toggleCamera = useCallback(() => {
    const track = activeVideoTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
    socketRef.current?.emit(STREAM_EVENTS.TRACK_STATE, {
      roomId: roomIdRef.current,
      micEnabled,
      cameraEnabled: track.enabled,
      videoSource,
    });
  }, [micEnabled, videoSource]);

  function replaceOutgoingVideoTrack(track: MediaStreamTrack) {
    peersRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      void sender?.replaceTrack(track);
    });
    const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
    localStreamRef.current = new MediaStream([...audioTracks, track]);
    activeVideoTrackRef.current = track;
    setLocalStream(localStreamRef.current);
  }

  const toggleScreenShare = useCallback(async () => {
    if (videoSource === 'camera') {
      let screenStream: MediaStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch {
        return; // user cancelled the screen picker
      }
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;
      screenTrack.onended = () => {
        if (activeVideoTrackRef.current === screenTrack) revertToCameraVideo();
      };
      replaceOutgoingVideoTrack(screenTrack);
      setVideoSource('screen');
      socketRef.current?.emit(STREAM_EVENTS.TRACK_STATE, {
        roomId: roomIdRef.current,
        micEnabled,
        cameraEnabled,
        videoSource: 'screen',
      });
    } else {
      revertToCameraVideo();
    }

    function revertToCameraVideo() {
      const camTrack = cameraVideoTrackRef.current;
      if (!camTrack) return;
      const previousTrack = activeVideoTrackRef.current;
      if (previousTrack && previousTrack !== camTrack) previousTrack.stop();
      replaceOutgoingVideoTrack(camTrack);
      setVideoSource('camera');
      socketRef.current?.emit(STREAM_EVENTS.TRACK_STATE, {
        roomId: roomIdRef.current,
        micEnabled,
        cameraEnabled,
        videoSource: 'camera',
      });
    }
  }, [videoSource, micEnabled, cameraEnabled]);

  // Broadcaster-only: pick a different camera without restarting the stream.
  // Reuses the same live-replace pattern as screen-share (no renegotiation
  // needed, just swap the RTCRtpSender's track on every open peer connection).
  const switchCamera = useCallback(
    async (deviceId: string) => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
      } catch (err) {
        setMediaError(await classifyMediaErrorAsync(err, 'switch camera'));
        return;
      }
      const newTrack = stream.getVideoTracks()[0];
      if (!newTrack) return;

      const oldCameraTrack = cameraVideoTrackRef.current;
      cameraVideoTrackRef.current = newTrack;
      if (videoSource === 'camera') {
        replaceOutgoingVideoTrack(newTrack);
      }
      oldCameraTrack?.stop();
    },
    [videoSource],
  );

  // Broadcaster-only: pick a different microphone live, same idea as
  // switchCamera but for the audio sender.
  const switchMicrophone = useCallback(async (deviceId: string) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    } catch (err) {
      setMediaError(await classifyMediaErrorAsync(err, 'switch microphone'));
      return;
    }
    const newTrack = stream.getAudioTracks()[0];
    if (!newTrack) return;
    newTrack.enabled = micEnabled;

    peersRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      void sender?.replaceTrack(newTrack);
    });

    const oldAudioTrack = localStreamRef.current?.getAudioTracks()[0];
    const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
    localStreamRef.current = new MediaStream([newTrack, ...videoTracks]);
    setLocalStream(localStreamRef.current);
    oldAudioTrack?.stop();
  }, [micEnabled]);

  const sendChatMessage = useCallback((text: string) => {
    if (!text.trim() || !roomIdRef.current) return;
    socketRef.current?.emit(STREAM_EVENTS.SEND_STREAM_MESSAGE, {
      roomId: roomIdRef.current,
      displayName: displayNameRef.current,
      text: text.trim(),
    });
  }, []);

  const sendReaction = useCallback(() => {
    if (!roomIdRef.current) return;
    socketRef.current?.emit(STREAM_EVENTS.SEND_REACTION, { roomId: roomIdRef.current });
  }, []);

  const kickViewer = useCallback((viewerPeerId: string) => {
    if (!roomIdRef.current) return;
    socketRef.current?.emit(STREAM_EVENTS.KICK_VIEWER, { roomId: roomIdRef.current, viewerPeerId });
  }, []);

  const endStream = useCallback(() => {
    if (!roomIdRef.current) return;
    socketRef.current?.emit(STREAM_EVENTS.END_STREAM, { roomId: roomIdRef.current });
  }, []);

  const toggleCaptionsVisible = useCallback(() => setCaptionsVisible((v) => !v), []);
  const dismissEndedOrKicked = useCallback(() => {
    setEndedReason(null);
    setKickedReason(null);
  }, []);

  return {
    streams,
    isSocketConnected,
    role,
    roomId,
    displayName,
    viewerCount,
    micEnabled,
    cameraEnabled,
    videoSource,
    localStream,
    remoteStream,
    captionsSupported,
    captionsVisible,
    captionStatus,
    finalCaption,
    interimCaption,
    chatMessages,
    reactionBursts,
    viewers,
    joinError,
    mediaError,
    creating,
    joining,
    endedReason,
    kickedReason,
    streamStartedAt,
    viewerConnectionType,
    createdPassword,
    createStream,
    joinStream,
    leaveStream,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    switchCamera,
    switchMicrophone,
    sendChatMessage,
    sendReaction,
    kickViewer,
    endStream,
    toggleCaptionsVisible,
    dismissEndedOrKicked,
  };
}
