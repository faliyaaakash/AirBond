// Socket events for the chat module, scoped to its own "/chat" namespace.
export const CHAT_EVENTS = {
  JOIN_ROOM: 'join-room',
  JOIN_SUCCESS: 'join-success',
  JOIN_ERROR: 'join-error',
  LEAVE_ROOM: 'leave-room',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
  SEND_MESSAGE: 'send-message',
  NEW_MESSAGE: 'new-message',
  TYPING_START: 'typing-start',
  TYPING_STOP: 'typing-stop',
  USER_TYPING: 'user-typing',
  ROOM_CLOSED: 'room-closed',
  CHAT_ERROR: 'chat-error',
  REACT_MESSAGE: 'react-message',
  MESSAGE_REACTED: 'message-reacted',
} as const;
