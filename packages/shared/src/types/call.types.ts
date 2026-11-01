export interface CallCreatedPayload {
  roomId: string;
}

export interface JoinCallPayload {
  roomId: string;
}

// The joiner learns the host's peerId so it can wait for the host's offer
// (the existing participant always initiates, same convention as every other
// mesh/room feature in this app).
export interface CallJoinedPayload {
  roomId: string;
  peerId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
}

export type CallJoinErrorCode = 'CALL_NOT_FOUND' | 'CALL_FULL' | 'INVALID_INPUT';

export interface CallJoinErrorPayload {
  code: CallJoinErrorCode;
  message: string;
}

export interface CallPeerJoinedPayload {
  peerId: string;
}

// A call is exactly two people - either one leaving (or disconnecting) ends
// it for both, there's no "host" to hand off to and no one left to re-pair.
export type CallEndedReason = 'PEER_LEFT' | 'EXPIRED';

export interface CallEndedPayload {
  reason: CallEndedReason;
}

export interface SendCallTrackStatePayload {
  roomId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
}

export interface CallTrackStatePayload {
  micEnabled: boolean;
  cameraEnabled: boolean;
}
