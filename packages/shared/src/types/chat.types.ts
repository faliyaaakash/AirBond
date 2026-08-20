// REST payloads (chat room creation & lookup)
export interface CreateChatRoomRequest {
  roomName: string;
  isPrivate: boolean;
  password?: string;
}

export interface ChatRoomSummary {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  participantCount: number;
  expiresAt: string; // ISO timestamp
}

// WebSocket payloads ("/chat" namespace)
export interface ChatParticipant {
  socketId: string;
  stageName: string;
}

export interface ChatJoinRoomPayload {
  roomId: string;
  stageName: string;
  password?: string;
}

export interface ChatJoinSuccessPayload extends ChatRoomSummary {
  participants: ChatParticipant[];
}

export type ChatJoinErrorReason =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'INVALID_PASSWORD'
  | 'NAME_TAKEN'
  | 'INVALID_INPUT';

export interface ChatJoinErrorPayload {
  reason: ChatJoinErrorReason;
  message: string;
}

export interface ChatUserJoinedPayload {
  stageName: string;
  participantCount: number;
}

export interface ChatUserLeftPayload {
  stageName: string;
  participantCount: number;
}

// A snippet of an earlier message, attached client-side when composing a reply.
// The server never stores messages, so it can't look this up itself — the replying
// client supplies it, and the server just relays it along with the new message.
export interface ChatReplyPreview {
  messageId: string;
  stageName: string;
  snippet: string;
}

export interface ChatSendMessagePayload {
  text: string;
  replyTo?: ChatReplyPreview;
}

export interface ChatMessagePayload {
  messageId: string;
  stageName: string;
  text: string;
  sentAt: string; // ISO timestamp
  replyTo?: ChatReplyPreview;
}

export interface ChatReactPayload {
  messageId: string;
  reacted: boolean;
}

export interface ChatMessageReactedPayload {
  messageId: string;
  stageName: string;
  reacted: boolean;
}

export interface ChatTypingPayload {
  isTyping: boolean;
}

export interface ChatUserTypingPayload {
  stageName: string;
  isTyping: boolean;
}

export interface ChatRoomClosedPayload {
  reason: 'EXPIRED';
}

export type ChatErrorCode =
  | 'RATE_LIMITED'
  | 'MESSAGE_TOO_LONG'
  | 'MESSAGE_EMPTY'
  | 'INVALID_INPUT';

export interface ChatErrorPayload {
  code: ChatErrorCode;
  message: string;
}
