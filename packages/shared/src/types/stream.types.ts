export type VideoSource = 'camera' | 'screen';

// The live "what's on now" list - pushed to every client connected to the
// "/stream" namespace, refreshed on any create/end/change. Never includes
// the password hash, only whether a password is required.
export interface StreamSummary {
  roomId: string;
  title: string;
  isPrivate: boolean;
  viewerCount: number;
  createdAt: string; // ISO timestamp
}

export interface CreateStreamPayload {
  title: string;
  isPrivate: boolean;
  password?: string;
}

export interface StreamCreatedPayload {
  roomId: string;
}

// How a viewer arrived at this stream - surfaced in the dashboard so it's
// visible whether deep-link sharing actually drives joins vs. discovery/code.
export type StreamJoinSource = 'discovery' | 'code' | 'link';

export interface JoinStreamPayload {
  roomId: string;
  displayName: string;
  password?: string;
  joinSource?: StreamJoinSource;
}

export interface StreamJoinedPayload {
  roomId: string;
  broadcasterPeerId: string;
  viewerCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
}

export type StreamJoinErrorCode =
  | 'STREAM_NOT_FOUND'
  | 'INVALID_PASSWORD'
  | 'INVALID_INPUT';

export interface StreamJoinErrorPayload {
  code: StreamJoinErrorCode;
  message: string;
}

export interface ViewerJoinedPayload {
  viewerPeerId: string;
  displayName: string;
}

export interface ViewerLeftPayload {
  viewerPeerId: string;
}

export interface ViewerCountPayload {
  count: number;
}

export interface KickViewerPayload {
  roomId: string;
  viewerPeerId: string;
}

export interface StreamKickedPayload {
  reason: string;
}

export type StreamEndedReason =
  | 'ENDED_BY_BROADCASTER'
  | 'BROADCASTER_LEFT'
  | 'EXPIRED';

export interface StreamEndedPayload {
  reason: StreamEndedReason;
}

// Live captions - interim results update in place, final results settle the
// line. Text is relayed only, never stored anywhere.
export interface SendCaptionPayload {
  roomId: string;
  text: string;
  isFinal: boolean;
}

export interface CaptionPayload {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface SendTrackStatePayload {
  roomId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
}

export interface TrackStatePayload {
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
}

// Lightweight stream-chat sidebar - deliberately simpler than the main chat
// module (no reactions/replies/typing indicators), scoped 1:1 to the stream's
// lifecycle and never persisted.
export interface SendStreamMessagePayload {
  roomId: string;
  displayName: string;
  text: string;
}

export interface NewStreamMessagePayload {
  messageId: string;
  displayName: string;
  text: string;
  sentAt: string; // ISO timestamp
}

export interface SendReactionPayload {
  roomId: string;
}

export interface NewReactionPayload {
  displayName: string;
  timestamp: number;
}

export type StreamErrorCode = 'RATE_LIMITED' | 'INVALID_INPUT' | 'NOT_BROADCASTER';

export interface StreamErrorPayload {
  code: StreamErrorCode;
  message: string;
}
