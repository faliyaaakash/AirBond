export interface CreateRoomPayload { type: import('../constants/room-types').RoomType; }
export interface RoomCreatedPayload { roomId: string; }
export interface JoinRoomPayload { roomId: string; }

//WebRTC SDP Offer message.(A->B)
export interface SdpOfferPayload {
  targetPeerId: string;              //unique session id of remote peer
  senderPeerId?: string;            //(optional)signaling server before forwarding so the recipient knows which peer sent the offer.
  sdp: RTCSessionDescriptionInit;  //Session Description Protocol object
}

//webrtc answer offer(B->A)
export interface SdpAnswerPayload {
  targetPeerId: string;          
  senderPeerId?: string;
  sdp: RTCSessionDescriptionInit;
}

//SHOW ICE candidates PAYLOAD(a->b & same happen between b->a)
export interface IceCandidatePayload {
  targetPeerId: string;         
  senderPeerId?: string;
  candidate: RTCIceCandidateInit;
}

//show Users of one room
export interface RoomUsersPayload {
  peers: string[];
}

// Lightweight metadata-only progress ping sent alongside a P2P file transfer.
// Never carries file content - just enough for the live stats dashboard to show
// what's happening (filename, size, bytes so far) without the server ever
// touching the actual bytes, which still travel peer-to-peer over WebRTC.
export interface FileTransferProgressPayload {
  roomId: string;
  direction: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
}

// Reported once a peer connection settles, classifying how it connected -
// never anything about the connection's content. Lets the dashboard show
// whether a transfer actually went direct peer-to-peer or needed a TURN relay.
export interface ConnectionInfoPayload {
  roomId: string;
  connectionType: 'direct' | 'relay' | 'unknown';
}