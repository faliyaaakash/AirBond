import { useState } from 'react';
import type { NewStreamMessagePayload } from '@airbond/shared';
import { theme } from '../theme';
import type { ReactionBurst } from './useStreamSession';

interface StreamChatPanelProps {
  messages: NewStreamMessagePayload[];
  onSend: (text: string) => void;
  onReact: () => void;
  reactionBursts: ReactionBurst[];
}

// Deliberately simpler than the main chat module - text only, no
// reactions/replies/typing indicators, scoped 1:1 to the stream's lifecycle.
export default function StreamChatPanel({ messages, onSend, onReact, reactionBursts }: StreamChatPanelProps) {
  const [draft, setDraft] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div
      style={{
        flex: '1 1 240px',
        maxWidth: 280,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        background: theme.color.panel,
        display: 'flex',
        flexDirection: 'column',
        height: 440,
      }}
    >
      <style>{`
        @keyframes stream-reaction-float {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-60px); }
        }
      `}</style>

      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${theme.color.border}`,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: theme.color.textSecondary,
        }}
      >
        STREAM CHAT
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.length === 0 && <p style={{ fontSize: 12, color: theme.color.textSecondary }}>No messages yet.</p>}
        {messages.map((message) => (
          <div key={message.messageId} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.color.accentHover }}>{message.displayName}</div>
            <div style={{ fontSize: 13, wordBreak: 'break-word' }}>{message.text}</div>
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', height: 0 }}>
        {reactionBursts.map((burst, i) => (
          <span
            key={burst.id}
            title={`${burst.displayName} reacted`}
            style={{
              position: 'absolute',
              right: 16 + (i % 3) * 16,
              bottom: 0,
              fontSize: 20,
              animation: 'stream-reaction-float 2s ease-out forwards',
            }}
          >
            ❤️
          </span>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6, padding: 10, borderTop: `1px solid ${theme.color.border}` }}>
        <button
          type="button"
          onClick={onReact}
          aria-label="Send a heart reaction"
          style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: theme.color.danger }}
        >
          ♡
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something..."
          maxLength={500}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: theme.radius.sm,
            border: `1px solid ${theme.color.border}`,
            fontSize: 13,
            fontFamily: theme.font.body,
          }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          style={{
            border: 'none',
            borderRadius: theme.radius.sm,
            padding: '0 12px',
            background: draft.trim() ? theme.color.accent : theme.color.border,
            color: '#fff',
            cursor: draft.trim() ? 'pointer' : 'default',
            fontSize: 13,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
