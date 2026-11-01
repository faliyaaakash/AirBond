// Socket events for 1:1 video calling, scoped to its own "/call" namespace.
// Deliberately smaller than the stream module - no discovery list (calls are
// private, join-by-room-ID/link only), no chat sidebar, no captions: just
// room lifecycle for exactly two participants plus the WebRTC signaling relay.
export const CALL_EVENTS = {
  CREATE_CALL: 'create-call',
  CALL_CREATED: 'call-created',
  JOIN_CALL: 'join-call',
  CALL_JOINED: 'call-joined',
  JOIN_ERROR: 'call-join-error',

  PEER_JOINED: 'call-peer-joined',
  LEAVE_CALL: 'leave-call',
  CALL_ENDED: 'call-ended',

  // WebRTC signaling relay (the two participants, directly)
  SDP_OFFER: 'sdp-offer',
  SDP_ANSWER: 'sdp-answer',
  ICE_CANDIDATE: 'ice-candidate',

  // Media state (mic/camera)
  TRACK_STATE: 'track-state',
} as const;
