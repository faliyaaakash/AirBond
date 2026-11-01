// Socket events for the live-streaming module, scoped to its own "/stream"
// namespace. Covers discovery (the live "what's on now" list), broadcaster/
// viewer lifecycle, WebRTC signaling relay, live captions, the lightweight
// stream-chat sidebar, and reactions.
export const STREAM_EVENTS = {
  // Discovery - pushed to every connected client, not polled.
  STREAM_LIST: 'stream-list',

  // Lifecycle
  CREATE_STREAM: 'create-stream',
  STREAM_CREATED: 'stream-created',
  JOIN_STREAM: 'join-stream',
  STREAM_JOINED: 'stream-joined',
  JOIN_ERROR: 'stream-join-error',
  END_STREAM: 'end-stream',
  STREAM_ENDED: 'stream-ended',

  // Viewers
  VIEWER_JOINED: 'viewer-joined',
  VIEWER_LEFT: 'viewer-left',
  VIEWER_COUNT: 'viewer-count',
  KICK_VIEWER: 'kick-viewer',
  STREAM_KICKED: 'stream-kicked',

  // WebRTC signaling relay (broadcaster <-> each viewer)
  SDP_OFFER: 'sdp-offer',
  SDP_ANSWER: 'sdp-answer',
  ICE_CANDIDATE: 'ice-candidate',
  CONNECTION_INFO: 'connection-info',

  // Media state (mic/camera/screen-share)
  TRACK_STATE: 'track-state',

  // Live captions (interim + final, never stored)
  CAPTION: 'caption',

  // Lightweight stream-chat sidebar (text only, no reactions/replies/typing)
  SEND_STREAM_MESSAGE: 'send-stream-message',
  NEW_STREAM_MESSAGE: 'new-stream-message',

  // Reactions (single heart burst)
  SEND_REACTION: 'send-reaction',
  NEW_REACTION: 'new-reaction',

  STREAM_ERROR: 'stream-error',
} as const;
