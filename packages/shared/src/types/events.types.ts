export interface CreateRoomPayload { type: import('../constants/room-types').RoomType; }
 export interface RoomCreatedPayload { roomId: string; }
  export interface JoinRoomPayload { roomId: string; } 
 export interface SdpPayload { roomId: string; sdp: RTCSessionDescriptionInit; } 
export interface IceCandidatePayload { roomId: string; candidate: RTCIceCandidateInit; } 