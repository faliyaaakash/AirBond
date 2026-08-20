import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CHAT_EVENTS } from '@airbond/shared';
import type {
  ChatErrorPayload,
  ChatJoinErrorPayload,
  ChatJoinSuccessPayload,
  ChatMessagePayload,
  ChatMessageReactedPayload,
  ChatReplyPreview,
  ChatRoomSummary,
  ChatUserJoinedPayload,
  ChatUserLeftPayload,
  ChatUserTypingPayload,
} from '@airbond/shared';
import { createChatRoom } from './chatApi';

const TYPING_STOP_DELAY_MS = 3000;
const TOAST_LIFETIME_MS = 4000;
const TRANSIENT_ERROR_LIFETIME_MS = 4000;
const REPLY_SNIPPET_MAX_LENGTH = 120;

export interface ChatMessage extends ChatMessagePayload {
  isOwn: boolean;
}

export interface ChatToast {
  id: string;
  text: string;
}

export type ChatPhase = 'idle' | 'joining' | 'joined' | 'closed';

export function useChatSocket() {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string>('');
  const stageNameRef = useRef<string>('');
  const passwordRef = useRef<string | undefined>(undefined);
  const isTypingRef = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Purely a client-side "I was the one who filled out the create-room form" flag —
  // there's no server-side host concept (see the "everyone equal" chat design), so
  // this only ever labels the current browser's own tab, never other participants.
  const isHostRef = useRef(false);

  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [room, setRoom] = useState<ChatRoomSummary | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [replyTarget, setReplyTarget] = useState<ChatReplyPreview | null>(null);
  const [typingStageNames, setTypingStageNames] = useState<string[]>([]);
  const [joinError, setJoinError] = useState<ChatJoinErrorPayload | null>(null);
  const [chatError, setChatError] = useState<ChatErrorPayload | null>(null);
  const [toasts, setToasts] = useState<ChatToast[]>([]);

  function pushToast(text: string) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_LIFETIME_MS);
  }

  function resetRoomState() {
    roomIdRef.current = '';
    stageNameRef.current = '';
    passwordRef.current = undefined;
    isHostRef.current = false;
    setRoom(null);
    setParticipants([]);
    setMessages([]);
    setReactions({});
    setReplyTarget(null);
    setTypingStageNames([]);
    setJoinError(null);
    setPhase('idle');
    stopTypingNow();
  }

  function stopTypingNow() {
    if (typingStopTimer.current) {
      clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
    if (isTypingRef.current && socketRef.current && roomIdRef.current) {
      isTypingRef.current = false;
      socketRef.current.emit(CHAT_EVENTS.TYPING_STOP, { roomId: roomIdRef.current });
    }
  }

  function attemptJoin(roomId: string, stageName: string, password: string | undefined) {
    if (!socketRef.current) return;
    setJoinError(null);
    setPhase('joining');
    socketRef.current.emit(CHAT_EVENTS.JOIN_ROOM, { roomId, stageName, password });
  }

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';
    const socket = io(`${baseUrl}/chat`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsSocketConnected(true);
      // Silently rejoin after a reconnect (e.g. brief network drop) if we were mid-session.
      if (roomIdRef.current && stageNameRef.current) {
        attemptJoin(roomIdRef.current, stageNameRef.current, passwordRef.current);
      }
    });

    socket.on('connect_error', () => {
      setIsSocketConnected(false);
    });

    socket.on('disconnect', () => {
      setIsSocketConnected(false);
    });

    socket.on(CHAT_EVENTS.JOIN_SUCCESS, (data: ChatJoinSuccessPayload) => {
      const { participants: roster, ...summary } = data;
      setRoom(summary);
      setParticipants(roster.map((member) => member.stageName));
      setMessages([]);
      setReactions({});
      setReplyTarget(null);
      setJoinError(null);
      setPhase('joined');
    });

    socket.on(CHAT_EVENTS.JOIN_ERROR, (data: ChatJoinErrorPayload) => {
      setJoinError(data);
      setPhase('idle');
    });

    socket.on(CHAT_EVENTS.USER_JOINED, (data: ChatUserJoinedPayload) => {
      setParticipants((prev) => (prev.includes(data.stageName) ? prev : [...prev, data.stageName]));
      pushToast(`${data.stageName} joined`);
    });

    socket.on(CHAT_EVENTS.USER_LEFT, (data: ChatUserLeftPayload) => {
      setParticipants((prev) => prev.filter((name) => name !== data.stageName));
      setTypingStageNames((prev) => prev.filter((name) => name !== data.stageName));
      pushToast(`${data.stageName} left`);
    });

    socket.on(CHAT_EVENTS.NEW_MESSAGE, (data: ChatMessagePayload) => {
      setMessages((prev) => [...prev, { ...data, isOwn: data.stageName === stageNameRef.current }]);
    });

    socket.on(CHAT_EVENTS.MESSAGE_REACTED, (data: ChatMessageReactedPayload) => {
      setReactions((prev) => {
        const reactors = prev[data.messageId] ?? [];
        const withoutStageName = reactors.filter((name) => name !== data.stageName);
        const next = data.reacted ? [...withoutStageName, data.stageName] : withoutStageName;
        return { ...prev, [data.messageId]: next };
      });
    });

    socket.on(CHAT_EVENTS.USER_TYPING, (data: ChatUserTypingPayload) => {
      setTypingStageNames((prev) => {
        if (data.isTyping) {
          return prev.includes(data.stageName) ? prev : [...prev, data.stageName];
        }
        return prev.filter((name) => name !== data.stageName);
      });
    });

    socket.on(CHAT_EVENTS.CHAT_ERROR, (data: ChatErrorPayload) => {
      setChatError(data);
      setTimeout(() => setChatError(null), TRANSIENT_ERROR_LIFETIME_MS);
    });

    socket.on(CHAT_EVENTS.ROOM_CLOSED, () => {
      setPhase('closed');
      roomIdRef.current = '';
      stageNameRef.current = '';
      passwordRef.current = undefined;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = (roomName: string, isPrivateRoom: boolean, password?: string) =>
    createChatRoom({ roomName, isPrivate: isPrivateRoom, password });

  const joinRoom = (roomId: string, stageName: string, password?: string, isCreator?: boolean) => {
    roomIdRef.current = roomId.trim();
    stageNameRef.current = stageName.trim();
    passwordRef.current = password;
    isHostRef.current = !!isCreator;
    attemptJoin(roomIdRef.current, stageNameRef.current, password);
  };

  const leaveRoom = () => {
    if (socketRef.current && roomIdRef.current) {
      socketRef.current.emit(CHAT_EVENTS.LEAVE_ROOM, { roomId: roomIdRef.current });
    }
    resetRoomState();
  };

  const sendMessage = (text: string) => {
    if (!socketRef.current || !roomIdRef.current || !text.trim()) return;
    socketRef.current.emit(CHAT_EVENTS.SEND_MESSAGE, {
      roomId: roomIdRef.current,
      text,
      replyTo: replyTarget ?? undefined,
    });
    setReplyTarget(null);
    stopTypingNow();
  };

  const notifyTyping = () => {
    if (!socketRef.current || !roomIdRef.current) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socketRef.current.emit(CHAT_EVENTS.TYPING_START, { roomId: roomIdRef.current });
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(stopTypingNow, TYPING_STOP_DELAY_MS);
  };

  const toggleReaction = (message: ChatMessage) => {
    if (!socketRef.current || !roomIdRef.current) return;
    const alreadyReacted = (reactions[message.messageId] ?? []).includes(stageNameRef.current);
    socketRef.current.emit(CHAT_EVENTS.REACT_MESSAGE, {
      roomId: roomIdRef.current,
      messageId: message.messageId,
      reacted: !alreadyReacted,
    });
  };

  const startReply = (message: ChatMessage) => {
    setReplyTarget({
      messageId: message.messageId,
      stageName: message.isOwn ? 'You' : message.stageName,
      snippet:
        message.text.length > REPLY_SNIPPET_MAX_LENGTH
          ? `${message.text.slice(0, REPLY_SNIPPET_MAX_LENGTH)}...`
          : message.text,
    });
  };

  const cancelReply = () => setReplyTarget(null);

  return {
    phase,
    isSocketConnected,
    room,
    participants,
    messages,
    reactions,
    replyTarget,
    typingStageNames: typingStageNames.filter((name) => name !== stageNameRef.current),
    joinError,
    chatError,
    toasts,
    stageName: stageNameRef.current,
    isHost: isHostRef.current,
    createRoom,
    joinRoom,
    leaveRoom,
    sendMessage,
    notifyTyping,
    toggleReaction,
    startReply,
    cancelReply,
  };
}
