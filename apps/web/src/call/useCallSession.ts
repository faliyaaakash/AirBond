import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CALL_EVENTS } from '@airbond/shared';
import type {
  CallEndedPayload,
  CallJoinedPayload,
  CallJoinErrorPayload,
  CallPeerJoinedPayload,
  CallTrackStatePayload,
} from '@airbond/shared';
import { ICE_CONFIG } from '../webrtc/iceConfig';
import { classifyConnectionType, type ConnectionType } from '../webrtc/connectionType';
import { classifyMediaErrorAsync, type MediaErrorInfo } from '../stream/mediaError';

export type CallRole = 'none' | 'host' | 'guest';

// Exactly two anonymous participants, one RTCPeerConnection, no mesh/Map
// bookkeeping needed (contrast usePeerConnection/useStreamSession, which both
// handle N peers) - this hook is the whole call's state for the page's
// lifetime, mirroring the "one hook, one socket" shape of its siblings.
export function useCallSession() {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string>('');
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef(false);
  const remotePeerIdRef = useRef<string>('');
  const localStreamRef = useRef<MediaStream | null>(null);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [role, setRole] = useState<CallRole>('none');
  const [roomId, setRoomId] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<CallJoinErrorPayload | null>(null);
  const [mediaError, setMediaError] = useState<MediaErrorInfo | null>(null);
  const [endedReason, setEndedReason] = useState<CallEndedPayload['reason'] | null>(null);
  const [connectionType, setConnectionType] = useState<ConnectionType>('unknown');

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteMicEnabled, setRemoteMicEnabled] = useState(true);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(true);

  function stopLocalMedia() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  }

  function resetSessionState() {
    peerRef.current?.close();
    peerRef.current = null;
    candidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
    remotePeerIdRef.current = '';
    stopLocalMedia();
    roomIdRef.current = '';
    setRole('none');
    setRoomId('');
    setCreating(false);
    setJoining(false);
    setRemoteStream(null);
    setMicEnabled(true);
    setCameraEnabled(true);
    setRemoteMicEnabled(true);
    setRemoteCameraEnabled(true);
    setConnectionType('unknown');
  }

  async function drainCandidateQueue(pc: RTCPeerConnection) {
    const queue = candidateQueueRef.current;
    candidateQueueRef.current = [];
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Error draining ICE candidate:', err);
      }
    }
  }

  function createPeerConnection(targetPeerId: string): RTCPeerConnection {
    peerRef.current?.close();
    remoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    remotePeerIdRef.current = targetPeerId;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit(CALL_EVENTS.ICE_CANDIDATE, {
          targetPeerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0] ?? null);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setRemoteStream(null);
        return;
      }
      if (pc.connectionState === 'connected') {
        void classifyConnectionType(pc).then(setConnectionType);
      }
    };

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    return pc;
  }

  // Bandwidth/CPU-conscious defaults for a 1:1 call (not an unconstrained
  // max-resolution request), plus explicit audio processing since a live
  // two-way call is far more exposed to echo/noise than a one-way stream.
  async function acquireLocalMedia(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      // facingMode is an "ideal" hint, not a hard constraint, so it can never
      // itself cause an OverconstrainedError - it just steers mobile devices
      // (which otherwise may default to the rear camera) to the front one.
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: { ideal: 'user' } },
    });
  }

  const createCall = useCallback(async () => {
    setJoinError(null);
    setMediaError(null);
    setEndedReason(null);

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
    let stream: MediaStream;
    try {
      stream = await acquireLocalMedia();
    } catch (err) {
      setCreating(false);
      setMediaError(await classifyMediaErrorAsync(err));
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    socketRef.current?.emit(CALL_EVENTS.CREATE_CALL);
  }, []);

  const joinCall = useCallback(async (targetRoomId: string) => {
    setJoinError(null);
    setMediaError(null);
    setEndedReason(null);

    if (!window.isSecureContext) {
      setMediaError({
        code: 'insecure-context',
        message:
          'Camera/microphone access requires a secure connection. This page was loaded over ' +
          'plain HTTP at a non-localhost address, which browsers block from using the camera.',
      });
      return;
    }

    setJoining(true);
    let stream: MediaStream;
    try {
      stream = await acquireLocalMedia();
    } catch (err) {
      setJoining(false);
      setMediaError(await classifyMediaErrorAsync(err));
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    socketRef.current?.emit(CALL_EVENTS.JOIN_CALL, { roomId: targetRoomId.trim() });
  }, []);

  const leaveCall = useCallback(() => {
    if (roomIdRef.current) {
      socketRef.current?.emit(CALL_EVENTS.LEAVE_CALL, { roomId: roomIdRef.current });
    }
    resetSessionState();
    // Force a fresh connection so the server's disconnect cleanup runs
    // immediately instead of waiting for a timeout.
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
    socketRef.current?.emit(CALL_EVENTS.TRACK_STATE, {
      roomId: roomIdRef.current,
      micEnabled: track.enabled,
      cameraEnabled,
    });
  }, [cameraEnabled]);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
    socketRef.current?.emit(CALL_EVENTS.TRACK_STATE, {
      roomId: roomIdRef.current,
      micEnabled,
      cameraEnabled: track.enabled,
    });
  }, [micEnabled]);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';
    const socket = io(`${baseUrl}/call`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('connect_error', () => setIsSocketConnected(false));
    socket.on('disconnect', () => setIsSocketConnected(false));

    socket.on(CALL_EVENTS.CALL_CREATED, (data: { roomId: string }) => {
      roomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setRole('host');
      setCreating(false);
    });

    socket.on(CALL_EVENTS.JOIN_ERROR, (data: CallJoinErrorPayload) => {
      setJoinError(data);
      setJoining(false);
      stopLocalMedia();
    });

    socket.on(CALL_EVENTS.CALL_JOINED, (data: CallJoinedPayload) => {
      roomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setRole('guest');
      setJoining(false);
      setRemoteMicEnabled(data.micEnabled);
      setRemoteCameraEnabled(data.cameraEnabled);
      // Tell the host our own (just-acquired, always-on) initial track state
      // so its "peer muted/camera off" indicators start correct too.
      socket.emit(CALL_EVENTS.TRACK_STATE, {
        roomId: data.roomId,
        micEnabled: true,
        cameraEnabled: true,
      });
    });

    // Host side: the other participant joined - initiate the offer (the
    // existing member always initiates, same convention as every other
    // mesh/room feature in this app).
    socket.on(CALL_EVENTS.PEER_JOINED, async (data: CallPeerJoinedPayload) => {
      const pc = createPeerConnection(data.peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit(CALL_EVENTS.SDP_OFFER, { targetPeerId: data.peerId, sdp: offer });
    });

    socket.on(
      CALL_EVENTS.SDP_OFFER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        const pc = createPeerConnection(data.senderPeerId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSetRef.current = true;
        await drainCandidateQueue(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit(CALL_EVENTS.SDP_ANSWER, { targetPeerId: data.senderPeerId, sdp: answer });
      },
    );

    socket.on(
      CALL_EVENTS.SDP_ANSWER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        const pc = peerRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSetRef.current = true;
        await drainCandidateQueue(pc);
      },
    );

    socket.on(
      CALL_EVENTS.ICE_CANDIDATE,
      async (data: { senderPeerId: string; candidate: RTCIceCandidateInit }) => {
        if (!data.candidate) return;
        const pc = peerRef.current;
        if (pc && remoteDescriptionSetRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.warn('Error adding ICE candidate:', err);
          }
        } else {
          candidateQueueRef.current.push(data.candidate);
        }
      },
    );

    socket.on(CALL_EVENTS.TRACK_STATE, (data: CallTrackStatePayload) => {
      setRemoteMicEnabled(data.micEnabled);
      setRemoteCameraEnabled(data.cameraEnabled);
    });

    socket.on(CALL_EVENTS.CALL_ENDED, (data: CallEndedPayload) => {
      setEndedReason(data.reason);
      resetSessionState();
    });

    return () => {
      socket.disconnect();
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
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
  };
}
