export const SOCKET_EVENTS = {
  CREATE_ROOM: 'create-room',
  ROOM_CREATED: 'room-created',
  JOIN_ROOM: 'join-room',
  PEER_JOINED: 'peer-joined',
  SDP_OFFER: 'sdp-offer',
  SDP_ANSWER: 'sdp-answer',
  ICE_CANDIDATE: 'ice-candidate',
  LEAVE_ROOM: 'leave-room',
  ROOM_CLOSED: 'room-closed',
} as const;
