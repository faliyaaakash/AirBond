import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@airbond/shared';
import { ICE_CONFIG } from './iceConfig';

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

  // Component state
  const [roomId, setRoomId] = useState<string>('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const [receivedBytes, setReceivedBytes] = useState<number>(0);
   
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

  

  useEffect(() => {
     
    //creates the Socket.IO client
    const socket = io('http://localhost:4000', {
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
            setReceivedBytes(0);
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
          }
        } catch (e) {
          console.error('DataChannel JSON parse error:', e);
        }
      } else {
        const chunk = new Uint8Array(event.data as ArrayBuffer);
        receivedChunksRef.current.push(chunk);
        setReceivedBytes((prev) => prev + chunk.byteLength);
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
    }

    // 3. Send EOF
    const eof = JSON.stringify({ type: 'EOF' });
    channels.forEach((dc) => dc.send(eof));
  };

  return {
    roomId,
    connectedPeers,
    isSocketConnected,
    createRoom,
    joinRoom,
    broadcastFile,
    receivedBytes,
  };
}



































// import { useEffect, useRef, useState } from 'react';
// import { io, Socket } from 'socket.io-client';
// import { SOCKET_EVENTS } from '@airbond/shared';


// //STUN SERVER: to get ICE(interactive connectivity establishment) candidates 
// const ICE_SERVERS: RTCConfiguration = {
//   iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'stun:stun1.l.google.com:19302' },
//   ],
// };

// export function usePeerConnection() {
//   const socketRef = useRef<Socket | null>(null);  //store SOCKET IO instance (ICE candidates)
//   const pcRef = useRef<RTCPeerConnection | null>(null);  // Manages the entire WebRTC peer lifecycle
//   const dataChannelRef = useRef<RTCDataChannel | null>(null); //Handles direct peer-to-peer data transfer(e.g., text chat, binary file chunks, arbitrary messages)
//   const roomIdRef = useRef<string>(''); //The current Room ID / Session identifier string.

//   const receivedChunksRef = useRef<Uint8Array[]>([]); 
//   const fileMetadataRef = useRef<{ name: string; size: number } | null>(null);

//   const [roomId, setRoomId] = useState<string>('');                    //store connected room ID 
//   const [isConnected, setIsConnected] = useState<boolean>(false);
//   const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
//   const [receivedBytes, setReceivedBytes] = useState<number>(0);


//   //syncing roomId state into roomIdRef reference
//   useEffect(() => {
//     roomIdRef.current = roomId;
//   }, [roomId]);


//   useEffect(() => {
//     const socket = io('http://localhost:4000', {
//       transports: ['polling', 'websocket'], // fallback polling first if ws is blocked
//       autoConnect: true,
//       reconnection: true,
//       reconnectionAttempts: 10,
//       reconnectionDelay: 1000,
//     });
//     socketRef.current = socket;

//     socket.on('connect', () => {
//       console.log('Connected to signaling server! Socket ID:', socket.id);
//       setIsSocketConnected(true);
//     });

//     socket.on('connect_error', (err) => {
//       console.error(' Connection error to signaling server:', err.message);
//       setIsSocketConnected(false);
//     });

//     socket.on(SOCKET_EVENTS.ROOM_CREATED, (data: { roomId: string }) => {
//       console.log('Room created:', data.roomId);
//       setRoomId(data.roomId);
//     });

//     // 1. Host side: Peer joined the room -> create WebRTC offer & data channel
//     socket.on(SOCKET_EVENTS.PEER_JOINED, async (data: { peerId: string }) => {
//       console.log(' Peer joined:', data.peerId, '-> Creating Offer...');
//       const pc = createPeerConnection();

//       const dc = pc.createDataChannel('fileTransfer', { ordered: true });
//       dataChannelRef.current = dc;
//       bindDataChannel(dc);

//       const offer = await pc.createOffer();
//       await pc.setLocalDescription(offer);

//       socket.emit(SOCKET_EVENTS.SDP_OFFER, {
//         roomId: roomIdRef.current,
//         sdp: offer,
//       });
//     });

//     // 2. Joiner side: Received offer -> create WebRTC answer & listen for data channel
//     socket.on(SOCKET_EVENTS.SDP_OFFER, async (data: { sdp: RTCSessionDescriptionInit }) => {
//       console.log(' Received SDP Offer -> Creating Answer...');
//       const pc = createPeerConnection();

//       pc.ondatachannel = (event) => {
//         console.log(' Joiner received remote DataChannel!');
//         dataChannelRef.current = event.channel;
//         bindDataChannel(event.channel);
//       };

//       await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
//       const answer = await pc.createAnswer();
//       await pc.setLocalDescription(answer);

//       socket.emit(SOCKET_EVENTS.SDP_ANSWER, {
//         roomId: roomIdRef.current,
//         sdp: answer,
//       });
//     });

//     // 3. Host side: Received answer
//     socket.on(SOCKET_EVENTS.SDP_ANSWER, async (data: { sdp: RTCSessionDescriptionInit }) => {
//       console.log(' Received SDP Answer -> Finalizing connection...');
//       if (pcRef.current) {
//         await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
//       }
//     });

//     // 4. ICE candidate exchange
//     socket.on(SOCKET_EVENTS.ICE_CANDIDATE, async (data: { candidate: RTCIceCandidateInit }) => {
//       if (data.candidate && pcRef.current) {
//         try {
//           await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
//         } catch (e) {
//           console.warn('Error adding ICE candidate:', e);
//         }
//       }
//     });

//     return () => {
//       socket.disconnect();
//       pcRef.current?.close();
//     };
//   }, []);

//   function createPeerConnection(): RTCPeerConnection {
//     if (pcRef.current) {
//       pcRef.current.close();
//     }

//     const pc = new RTCPeerConnection(ICE_SERVERS);
//     pcRef.current = pc;

//     pc.onicecandidate = (event) => {
//       if (event.candidate && socketRef.current) {
//         socketRef.current.emit(SOCKET_EVENTS.ICE_CANDIDATE, {
//           roomId: roomIdRef.current,
//           candidate: event.candidate,
//         });
//       }
//     };

//     pc.onconnectionstatechange = () => {
//       console.log('WebRTC Connection State:', pc.connectionState);
//       if (pc.connectionState === 'connected') {
//         setIsConnected(true);
//       } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
//         setIsConnected(false);
//       }
//     };

//     return pc;
//   }

//   function bindDataChannel(dc: RTCDataChannel) {
//     dc.binaryType = 'arraybuffer';

//     dc.onopen = () => {
//       console.log('DataChannel OPEN! P2P connection fully verified!');
//       setIsConnected(true); // <-- Direct trigger updates UI immediately
//     };

//     dc.onclose = () => {
//       console.log('DataChannel CLOSED');
//       setIsConnected(false);
//     };

//     dc.onmessage = (event) => {
//       if (typeof event.data === 'string') {
//         try {
//           const msg = JSON.parse(event.data);

//           if (msg.type === 'HEADER') {
//             console.log(`Receiving file: ${msg.name} (${msg.size} bytes)`);
//             fileMetadataRef.current = { name: msg.name, size: msg.size };
//             receivedChunksRef.current = [];
//             setReceivedBytes(0);
//           }

//           if (msg.type === 'EOF') {
//             console.log('Transfer complete. Triggering download...');
//             const meta = fileMetadataRef.current;
//             if (meta) {
//               const blob = new Blob(receivedChunksRef.current as BlobPart[]);
//               const url = URL.createObjectURL(blob);

//               const a = document.createElement('a');
//               a.href = url;
//               a.download = meta.name;
//               document.body.appendChild(a);
//               a.click();
//               a.remove();
//               URL.revokeObjectURL(url);
//               console.log(`Saved ${meta.name} successfully!`);
//             }
//             receivedChunksRef.current = [];
//           }
//         } catch (err) {
//           console.error('Error parsing control message:', err);
//         }
//       } else {
//         const chunk = new Uint8Array(event.data as ArrayBuffer);
//         receivedChunksRef.current.push(chunk);
//         setReceivedBytes((prev) => prev + chunk.byteLength);
//       }
//     };
//   }

//   const createRoom = () => {
//     if (!socketRef.current?.connected) {
//       alert('Signaling server is not connected!');
//       return;
//     }
//     socketRef.current.emit(SOCKET_EVENTS.CREATE_ROOM);
//   };

//   const joinRoom = (targetRoomId: string) => {
//     if (!socketRef.current?.connected) {
//       alert('Signaling server is not connected!');
//       return;
//     }
//     const cleanId = targetRoomId.trim();
//     setRoomId(cleanId);
//     roomIdRef.current = cleanId;
//     socketRef.current.emit(SOCKET_EVENTS.JOIN_ROOM, { roomId: cleanId });
//   };

//   return {
//     roomId,
//     isConnected,
//     isSocketConnected,
//     createRoom,
//     joinRoom,
//     dataChannelRef,
//     receivedBytes,
//   };
// }