import { useEffect, useReducer, useRef, useState } from 'react';
import type { useChatSocket, ChatMessage } from './useChatSocket';
import { formatMessageHtml, getEmojiOnlyInfo } from './formatMessage';
import { getStageNameColor } from './stageColor';
import Avatar from './Avatar';
import CopyButton from '../components/CopyButton';
import { theme } from '../theme';

interface ChatRoomProps {
  chat: ReturnType<typeof useChatSocket>;
}

const ASSUMED_ROOM_TTL_SECONDS = 7200; // matches the backend default; display-only

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
  padding: 0,
  margin: -1,
};

const SCROLL_BOTTOM_THRESHOLD_PX = 40;

function formatTimeLeft(expiresAtIso: string): { label: string; fraction: number } {
  const msLeft = new Date(expiresAtIso).getTime() - Date.now();
  const totalMinutes = Math.max(0, Math.floor(msLeft / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = msLeft <= 0 ? 'expired' : hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
  const fraction = Math.min(1, Math.max(0, msLeft / (ASSUMED_ROOM_TTL_SECONDS * 1000)));
  return { label, fraction };
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describeTyping(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing`;
}

function isScrolledToBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
}

export default function ChatRoom({ chat }: ChatRoomProps) {
  const {
    room,
    participants,
    messages,
    reactions,
    replyTarget,
    typingStageNames,
    chatError,
    toasts,
    isSocketConnected,
    stageName,
    isHost,
    sendMessage,
    notifyTyping,
    leaveRoom,
    toggleReaction,
    startReply,
    cancelReply,
  } = chat;

  const [draft, setDraft] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);

  // Re-renders every 30s purely to keep the "time left" countdown fresh; the value
  // itself is derived from `room` on each render rather than stored in state.
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const interval = setInterval(forceTick, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const grew = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (!grew) return;

    const lastMessage = messages[messages.length - 1];
    if (wasAtBottomRef.current || lastMessage?.isOwn) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    } else {
      setUnreadCount((n) => n + 1);
    }
  }, [messages]);

  if (!room) return null;

  const { label: timeLeft, fraction: timeFraction } = formatTimeLeft(room.expiresAt);
  const roomUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/chat/room/${room.roomId}` : room.roomId;
  const lastMessage = messages[messages.length - 1];
  const announcement =
    lastMessage && !lastMessage.isOwn ? `${lastMessage.stageName} says: ${lastMessage.text}` : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendMessage(text);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = isScrolledToBottom(el);
    wasAtBottomRef.current = atBottom;
    if (atBottom) setUnreadCount(0);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
  };

  return (
    <div
      style={{
        maxWidth: 1040,
        margin: '32px auto',
        padding: 20,
        fontFamily: theme.font.body,
        background: theme.color.background,
        borderRadius: theme.radius.md,
        position: 'relative',
      }}
    >
      <style>{`
        @keyframes chat-typing-dot {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>

      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 10,
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              background: theme.color.textPrimary,
              color: '#fff',
              padding: '8px 14px',
              borderRadius: theme.radius.sm,
              fontSize: 14,
            }}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <div aria-live="polite" style={visuallyHiddenStyle}>
        {announcement}
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingBottom: 12,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            title={isSocketConnected ? 'Connected' : 'Reconnecting...'}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: isSocketConnected ? theme.color.success : '#bbb',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <h2 style={{ margin: 0, fontFamily: theme.font.heading, color: theme.color.textPrimary }}>
            {room.roomName}
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              padding: '3px 10px',
              borderRadius: theme.radius.pill,
              background: room.isPrivate ? '#fbe0c8' : theme.color.successSoft,
              color: room.isPrivate ? theme.color.accentHover : theme.color.success,
            }}
          >
            {room.isPrivate ? 'PRIVATE' : 'PUBLIC'}
          </span>
          <div style={{ display: 'flex', marginLeft: 4 }}>
            {participants.slice(0, 3).map((name, i) => (
              <span key={name} style={{ marginLeft: i === 0 ? 0 : -10, border: '2px solid ' + theme.color.background, borderRadius: '50%' }}>
                <Avatar stageName={name} size={26} />
              </span>
            ))}
          </div>
          <span style={{ fontSize: 13, color: theme.color.textSecondary }}>{participants.length} connected</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <span
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: theme.radius.pill,
              background: theme.color.accentSoft,
              color: theme.color.accentHover,
              whiteSpace: 'nowrap',
            }}
          >
            ⏱ {timeLeft}
          </span>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Room options"
            aria-expanded={menuOpen}
            style={{
              borderRadius: '50%',
              width: 32,
              height: 32,
              border: `1px solid ${theme.color.border}`,
              background: theme.color.panel,
              cursor: 'pointer',
            }}
          >
            &#8230;
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 40,
                right: 0,
                background: theme.color.panel,
                border: `1px solid ${theme.color.border}`,
                borderRadius: theme.radius.md,
                padding: 16,
                width: 240,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 20,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.color.textSecondary, marginBottom: 6 }}>
                ROOM ID
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <code
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: theme.color.panelAlt,
                    borderRadius: theme.radius.sm,
                    fontSize: 13,
                  }}
                >
                  {room.roomId}
                </code>
                <CopyButton value={room.roomId} label="Copy" />
              </div>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(roomUrl);
                  } catch {
                    // ignore - clipboard unavailable, room ID above still works
                  }
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 0',
                  border: 'none',
                  borderTop: `1px solid ${theme.color.border}`,
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Invite by link
              </button>
              <button
                onClick={leaveRoom}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 0 0',
                  border: 'none',
                  borderTop: `1px solid ${theme.color.border}`,
                  background: 'transparent',
                  fontWeight: 600,
                  color: theme.color.danger,
                  cursor: 'pointer',
                }}
              >
                Leave room
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body: messages + sidebar */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, position: 'relative' }}>
          <div
            ref={listRef}
            onScroll={handleScroll}
            style={{
              height: 440,
              overflowY: 'auto',
              border: `1px solid ${theme.color.border}`,
              borderRadius: theme.radius.md,
              padding: 16,
              background: theme.color.panelAlt,
            }}
          >
            {messages.map((message) => (
              <MessageRow
                key={message.messageId}
                message={message}
                reactedBy={reactions[message.messageId] ?? []}
                selfStageName={stageName}
                onToggleReaction={() => toggleReaction(message)}
                onReply={() => startReply(message)}
              />
            ))}

            {typingStageNames.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Avatar stageName={typingStageNames[0]} size={22} />
                <TypingDots />
                <span style={{ fontSize: 12, color: theme.color.textSecondary }}>
                  {describeTyping(typingStageNames)}
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {unreadCount > 0 && (
            <button
              onClick={scrollToBottom}
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                borderRadius: theme.radius.pill,
                padding: '6px 14px',
                fontSize: 13,
                background: theme.color.textPrimary,
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >
              {unreadCount} new message{unreadCount > 1 ? 's' : ''} ↓
            </button>
          )}

          {chatError && (
            <p style={{ color: theme.color.danger, fontSize: 13, margin: '6px 0 0' }}>{chatError.message}</p>
          )}

          {replyTarget && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                padding: '6px 12px',
                background: theme.color.panel,
                border: `1px solid ${theme.color.border}`,
                borderRadius: theme.radius.sm,
                fontSize: 13,
              }}
            >
              <span style={{ color: theme.color.textSecondary }}>
                Replying to <strong>{replyTarget.stageName}</strong>: {replyTarget.snippet}
              </span>
              <button
                onClick={cancelReply}
                aria-label="Cancel reply"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}
              >
                &times;
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping();
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${room.roomName}...`}
              rows={2}
              maxLength={2000}
              style={{
                flex: 1,
                padding: '10px 14px',
                resize: 'none',
                boxSizing: 'border-box',
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.color.border}`,
                fontFamily: theme.font.body,
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send message"
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: 'none',
                background: draft.trim() ? theme.color.accent : theme.color.border,
                color: '#fff',
                fontSize: 18,
                cursor: draft.trim() ? 'pointer' : 'default',
                flexShrink: 0,
              }}
            >
              →
            </button>
          </form>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              background: theme.color.panel,
              border: `1px solid ${theme.color.border}`,
              borderRadius: theme.radius.md,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.color.textPrimary }}>
              Room expires in {timeLeft}
            </p>
            <p style={{ margin: '2px 0 8px', fontSize: 12, color: theme.color.textSecondary }}>
              Messages are not stored after the room closes.
            </p>
            <div style={{ height: 4, background: theme.color.border, borderRadius: 2 }}>
              <div
                style={{
                  height: 4,
                  width: `${timeFraction * 100}%`,
                  background: theme.color.accent,
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div
          style={{
            flex: '1 1 220px',
            maxWidth: 260,
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius.md,
            padding: 14,
            background: theme.color.panel,
            height: 'fit-content',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.color.textSecondary, marginBottom: 10 }}>
            IN THE ROOM · {participants.length}
          </div>
          {participants.map((name) => {
            const isSelf = name === stageName;
            const isTyping = typingStageNames.includes(name);
            const status = isTyping ? 'typing...' : isSelf && isHost ? 'You · host' : isSelf ? 'You' : 'active now';
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Avatar stageName={name} size={28} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.color.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, color: isTyping ? theme.color.accent : theme.color.textSecondary }}>
                    {status}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  reactedBy: string[];
  selfStageName: string;
  onToggleReaction: () => void;
  onReply: () => void;
}

function MessageRow({ message, reactedBy, selfStageName, onToggleReaction, onReply }: MessageRowProps) {
  const { isJumboEmoji } = getEmojiOnlyInfo(message.text);
  const nameColor = getStageNameColor(message.stageName);
  const hasReacted = reactedBy.includes(selfStageName);

  return (
    <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexDirection: message.isOwn ? 'row-reverse' : 'row' }}>
      {!message.isOwn && <Avatar stageName={message.stageName} size={30} />}
      <div style={{ maxWidth: '75%' }}>
        <div
          style={{
            fontSize: 12,
            color: message.isOwn ? '#888' : nameColor,
            fontWeight: message.isOwn ? 400 : 600,
            textAlign: message.isOwn ? 'right' : 'left',
          }}
        >
          {message.isOwn ? 'You' : message.stageName} · {formatTimestamp(message.sentAt)}
        </div>
        <div
          style={{
            display: 'inline-block',
            padding: isJumboEmoji ? 0 : '10px 14px',
            borderRadius: theme.radius.md,
            background: isJumboEmoji ? 'transparent' : message.isOwn ? theme.color.accentSoft : theme.color.panel,
            border: isJumboEmoji ? 'none' : `1px solid ${theme.color.border}`,
            fontSize: isJumboEmoji ? 40 : 15,
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}
        >
          {message.replyTo && (
            <div
              style={{
                borderLeft: `2px solid ${theme.color.accent}`,
                paddingLeft: 8,
                marginBottom: 6,
                fontSize: 12,
                color: theme.color.textSecondary,
              }}
            >
              ↩ {message.replyTo.stageName}: {message.replyTo.snippet}
            </div>
          )}
          <span
            dangerouslySetInnerHTML={{
              __html: isJumboEmoji ? message.text : formatMessageHtml(message.text),
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 3,
            justifyContent: message.isOwn ? 'flex-end' : 'flex-start',
          }}
        >
          <button
            onClick={onToggleReaction}
            aria-pressed={hasReacted}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: hasReacted ? theme.color.danger : theme.color.textSecondary,
              padding: 0,
            }}
          >
            {hasReacted ? '♥' : '♡'} {reactedBy.length > 0 ? reactedBy.length : ''}
          </button>
          <button
            onClick={onReply}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: theme.color.textSecondary,
              padding: 0,
            }}
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 3,
        padding: '6px 10px',
        background: theme.color.panel,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.pill,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: theme.color.textSecondary,
            animation: 'chat-typing-dot 1.2s infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  );
}
