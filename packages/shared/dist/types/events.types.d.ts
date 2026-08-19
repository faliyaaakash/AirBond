export interface CreateRoomPayload {
    type: import('../constants/room-types').RoomType;
}
export interface RoomCreatedPayload {
    roomId: string;
}
export interface JoinRoomPayload {
    roomId: string;
}
export interface SdpPayload {
    roomId: string;
    sdp: RTCSessionDescriptionInit;
}
export interface IceCandidatePayload {
    roomId: string;
    candidate: RTCIceCandidateInit;
}
export interface SdpOfferPayload {
    targetPeerId: string;
    senderPeerId?: string;
    sdp: RTCSessionDescriptionInit;
}
export interface SdpAnswerPayload {
    targetPeerId: string;
    senderPeerId?: string;
    sdp: RTCSessionDescriptionInit;
}
export interface IceCandidatePayload {
    targetPeerId: string;
    senderPeerId?: string;
    candidate: RTCIceCandidateInit;
}
export interface RoomUsersPayload {
    peers: string[];
}
