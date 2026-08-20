import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@airbond/shared';
import { ICE_CONFIG } from './iceConfig';

interface TransferSample {
  time: number;
  bytes: number;
}

const SPEED_SAMPLE_WINDOW_MS = 2000;
const UI_UPDATE_THROTTLE_MS = 150;

function computeSpeedBps(samples: TransferSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedSeconds = (last.time - first.time) / 1000;
  if (elapsedSeconds <= 0) return 0;
  return (last.bytes - first.bytes) / elapsedSeconds;
}

function pruneOldSamples(samples: TransferSample[], now: number) {
  while (samples.length > 0 && now - samples[0].time > SPEED_SAMPLE_WINDOW_MS) {
    samples.shift();
  }
}

export interface FileTransferMeta {
  name: string;
  size: number;
}

export function usePeerConnection() {
  const socketRef = useRef<Socket | null>(null); //socket referense object to store about socket
  const roomIdRef = useRef<string>('');  // room reference object to store room info : (roomIdRef.current to get value)

  // Multi-peer maps
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());  //store each peers connection recored (for multipeer connection)
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());  //store each peers datachanel recored : (what actually transfers your file data.)
  const candidateQueues = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()); //stores ICE candidates that arrive before the remote SDP description 

  // Incoming transfer buffers
  const receivedChunksRef = useRef<Uint8Array[]>([]);
  const fileMetadataRef = useRef<{ name: string; size: number } | null>(null);
  const receivedTotalRef = useRef<number>(0);
  const receiveSamplesRef = useRef<TransferSample[]>([]);
  const lastReceiveUiUpdateRef = useRef<number>(0);
  const sentSamplesRef = useRef<TransferSample[]>([]);
  const lastSendUiUpdateRef = useRef<number>(0);

  // Component state
  const [roomId, setRoomId] = useState<string>('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const [receivedBytes, setReceivedBytes] = useState<number>(0);
  const [receiveFileMeta, setReceiveFileMeta] = useState<FileTransferMeta | null>(null);
  const [receiveSpeedBps, setReceiveSpeedBps] = useState<number>(0);
  const [sendFileMeta, setSendFileMeta] = useState<FileTransferMeta | null>(null);
  const [sendProgress, setSendProgress] = useState<number>(0);
  const [sendSpeedBps, setSendSpeedBps] = useState<number>(0);

  //ready-state tracking ref
  const remoteDescriptionSet = useRef<Map<string, boolean>>(new Map());
  //sync room id
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);


  // Helper to sync open data channels to React state (checks which DataChannels are actually open and updates React UI)
  const updateConnectedPeerList = useCallback(() => {
    const activeIds: string[] = [];
    dataChannelsRef.current.forEach((dc, peerId) => {
      if (dc.readyState === 'open') {
        activeIds.push(peerId);
      }
    });
    setConnectedPeers([...activeIds]);
  }, []);



  function createPeerConnection(peerId: string): RTCPeerConnection {
    if (peersRef.current.has(peerId)) {
      peersRef.current.get(peerId)?.close();
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current.set(peerId, pc);
    candidateQueues.current.set(peerId, []);
    remoteDescriptionSet.current.set(peerId, false);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit(SOCKET_EVENTS.ICE_CANDIDATE, {
          targetPeerId: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer [${peerId}] State:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        closePeer(peerId);
      }
    };

    return pc;
  }

  function bindDataChannel(dc: RTCDataChannel, peerId: string) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log(`DataChannel OPEN with peer: ${peerId}`);
      updateConnectedPeerList();
    };

    dc.onclose = () => {
      console.log(`DataChannel CLOSED with peer: ${peerId}`);
      dataChannelsRef.current.delete(peerId);
      updateConnectedPeerList();
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'HEADER') {
            fileMetadataRef.current = { name: msg.name, size: msg.size };
            receivedChunksRef.current = [];
            receivedTotalRef.current = 0;
            receiveSamplesRef.current = [];
            setReceivedBytes(0);
            setReceiveFileMeta({ name: msg.name, size: msg.size });
            setReceiveSpeedBps(0);
          }
          if (msg.type === 'EOF') {
            const meta = fileMetadataRef.current;
            if (meta) {
              const blob = new Blob(receivedChunksRef.current.map(chunk => {
                    const buffer = new ArrayBuffer(chunk.byteLength);
                    new Uint8Array(buffer).set(chunk);
                    return buffer;
                  })
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = meta.name;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }
            receivedChunksRef.current = [];
            setReceivedBytes(receivedTotalRef.current);
            setReceiveSpeedBps(0);
          }
        } catch (e) {
          console.error('DataChannel JSON parse error:', e);
        }
      } else {
        const chunk = new Uint8Array(event.data as ArrayBuffer);
        receivedChunksRef.current.push(chunk);
        receivedTotalRef.current += chunk.byteLength;

        const now = Date.now();
        const samples = receiveSamplesRef.current;
        samples.push({ time: now, bytes: receivedTotalRef.current });
        pruneOldSamples(samples, now);

        const isLastChunk = fileMetadataRef.current
          ? receivedTotalRef.current >= fileMetadataRef.current.size
          : false;
        if (isLastChunk || now - lastReceiveUiUpdateRef.current > UI_UPDATE_THROTTLE_MS) {
          lastReceiveUiUpdateRef.current = now;
          setReceivedBytes(receivedTotalRef.current);
          setReceiveSpeedBps(computeSpeedBps(samples));
        }
      }
    };
  }

  async function drainCandidateQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = candidateQueues.current.get(peerId) || [];
    while (queue.length > 0) {
      const cand = queue.shift();
      if (cand) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn(`Error draining candidate for ${peerId}:`, err);
        }
      }
    }
  }

  function closePeer(peerId: string) {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    candidateQueues.current.delete(peerId);
    remoteDescriptionSet.current.delete(peerId);
    updateConnectedPeerList();
  }

  useEffect(() => {

    //creates the Socket.IO client
    const socket = io(import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000', {
      transports: ['websocket'],
    });

    //now socket is accessible from the rest of the hook
    socketRef.current = socket;
    
    //Socket.iO connection succeeds , Socket.IO assigns the connection a socket ID
    socket.on('connect', () => {
      console.log('Signaling Socket connected:', socket.id);
      setIsSocketConnected(true);
    });

    //socket io Connection error
    socket.on('connect_error', (err) => {
      console.error('Signaling error:', err.message);
      setIsSocketConnected(false);
    });
  
    //server generates the room ID
    socket.on(SOCKET_EVENTS.ROOM_CREATED, (data: { roomId: string }) => {
      console.log('Room created:', data.roomId);
      setRoomId(data.roomId);  //store roomid in react state
    });

     //webrtc connection creation offer( A new peer joined -> We (existing member) initiate offer to that peer)
    socket.on(SOCKET_EVENTS.PEER_JOINED, async (data: { peerId: string }) => {
      console.log(`Peer joined: ${data.peerId} -> Initiating connection`);
      const pc = createPeerConnection(data.peerId);    //create webrtc connection between two peer
       
       //create actual webrtc datachanel for file transfer
      const dc = pc.createDataChannel('fileTransfer', 
        { ordered: true } //means messege /chunks arrive in ordered
      ); 
        
      dataChannelsRef.current.set(data.peerId, dc); //Store DataChannel
      bindDataChannel(dc, data.peerId);

      const offer = await pc.createOffer();//suppose A , Create an offer describing how I want to communicate with B
      await pc.setLocalDescription(offer); //then A stores that offer as its local WebRTC description.
      
      //sending signaling information
      socket.emit(SOCKET_EVENTS.SDP_OFFER, {
        targetPeerId: data.peerId,
        sdp: offer,
      });
    });

    //Joining peer receives existing room members list from Redis
    socket.on('room-users', async (data: { peers: string[] }) => {
      console.log(`Existing room peers from Redis:`, data.peers);
      // Wait for existing peers to send offers
      data.peers.forEach((peerId) => {
        if (!peersRef.current.has(peerId)) {
          createPeerConnection(peerId);
        }
      });
    });


    //3. Receive targeted SDP Offer -> reply with targeted Answer
    socket.on( SOCKET_EVENTS.SDP_OFFER,
         async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`Received SDP Offer from ${data.senderPeerId}`);
        const pc = peersRef.current.get(data.senderPeerId) || createPeerConnection(data.senderPeerId);

        pc.ondatachannel = (event) => {
          console.log(`Received remote DataChannel from ${data.senderPeerId}`);
          dataChannelsRef.current.set(data.senderPeerId, event.channel);
          bindDataChannel(event.channel, data.senderPeerId);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSet.current.set(data.senderPeerId, true);
        await drainCandidateQueue(data.senderPeerId, pc);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit(SOCKET_EVENTS.SDP_ANSWER, {
          targetPeerId: data.senderPeerId,
          sdp: answer,
        });
      },
    );

    // 4. Receive targeted SDP Answer
    socket.on(
      SOCKET_EVENTS.SDP_ANSWER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`Received SDP Answer from ${data.senderPeerId}`);
        const pc = peersRef.current.get(data.senderPeerId);
       if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          remoteDescriptionSet.current.set(data.senderPeerId, true);
          await drainCandidateQueue(data.senderPeerId, pc);
    }
      },
    );

    // 5. Receive targeted ICE Candidate
    socket.on(
      SOCKET_EVENTS.ICE_CANDIDATE,
      async (data: { senderPeerId: string; candidate: RTCIceCandidateInit }) => {
        if (!data.candidate) return;
        const pc = peersRef.current.get(data.senderPeerId);
        const isReady = remoteDescriptionSet.current.get(data.senderPeerId);

        if (pc && isReady && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.warn(`Error adding ICE candidate:`, e);
          }
        } else {
          const queue = candidateQueues.current.get(data.senderPeerId) || [];
          queue.push(data.candidate);
          candidateQueues.current.set(data.senderPeerId, queue);
        }
      },
    );


    // 6. Handle peer leave / disconnect
    socket.on(SOCKET_EVENTS.LEAVE_ROOM, (data: { peerId: string }) => {
      console.log(` Peer left: ${data.peerId}`);
      closePeer(data.peerId);
    });

    return () => {
      socket.disconnect();
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      dataChannelsRef.current.clear();
    };
  },[updateConnectedPeerList])

  const createRoom = () => socketRef.current?.emit(SOCKET_EVENTS.CREATE_ROOM);

  const joinRoom = (targetRoomId: string) => {
    const cleanId = targetRoomId.trim();
    setRoomId(cleanId);
    roomIdRef.current = cleanId;
    socketRef.current?.emit(SOCKET_EVENTS.JOIN_ROOM, { roomId: cleanId });
  };

  // Broadcast file chunking to ALL connected mesh peers
  const broadcastFile = async (file: File) => {
    const CHUNK_SIZE = 64 * 1024;
    const channels = Array.from(dataChannelsRef.current.values()).filter(
      (dc) => dc.readyState === 'open',
    );

    if (channels.length === 0) {
      throw new Error('No peers currently connected to receive file!');
    }

    sentSamplesRef.current = [];
    lastSendUiUpdateRef.current = 0;
    setSendFileMeta({ name: file.name, size: file.size });
    setSendProgress(0);
    setSendSpeedBps(0);

    // 1. Send Header
    const header = JSON.stringify({ type: 'HEADER', name: file.name, size: file.size });
    channels.forEach((dc) => dc.send(header));

    // 2. Stream Chunks with Backpressure across all channels
    let offset = 0;
    while (offset < file.size) {
      // Check maximum buffer among active channels
      const maxBuffered = Math.max(...channels.map((dc) => dc.bufferedAmount));
      if (maxBuffered > 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      channels.forEach((dc) => dc.send(buffer));
      offset += buffer.byteLength;

      const now = Date.now();
      const samples = sentSamplesRef.current;
      samples.push({ time: now, bytes: offset });
      pruneOldSamples(samples, now);

      if (offset >= file.size || now - lastSendUiUpdateRef.current > UI_UPDATE_THROTTLE_MS) {
        lastSendUiUpdateRef.current = now;
        setSendProgress(offset / file.size);
        setSendSpeedBps(computeSpeedBps(samples));
      }
    }

    // 3. Send EOF
    const eof = JSON.stringify({ type: 'EOF' });
    channels.forEach((dc) => dc.send(eof));
    setSendSpeedBps(0);
  };

  return {
    roomId,
    connectedPeers,
    isSocketConnected,
    createRoom,
    joinRoom,
    broadcastFile,
    receivedBytes,
    receiveFileMeta,
    receiveSpeedBps,
    sendFileMeta,
    sendProgress,
    sendSpeedBps,
  };
}
