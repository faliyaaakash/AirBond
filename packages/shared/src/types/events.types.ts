export interface CreateRoomPayload { type: import('../constants/room-types').RoomType; }
 export interface RoomCreatedPayload { roomId: string; }
  export interface JoinRoomPayload { roomId: string; } 
 export interface SdpPayload { roomId: string; sdp: RTCSessionDescriptionInit; } 
export interface IceCandidatePayload { roomId: string; candidate: RTCIceCandidateInit; } 

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