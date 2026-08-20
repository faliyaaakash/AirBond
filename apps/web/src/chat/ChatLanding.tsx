import { useEffect, useState } from 'react';
import type { ChatJoinErrorPayload, ChatRoomSummary } from '@airbond/shared';
import { theme } from '../theme';
import { fetchChatRoom } from './chatApi';
import { randomStageName } from './randomStageName';

interface ChatLandingProps {
  isSocketConnected: boolean;
  isJoining: boolean;
  joinError: ChatJoinErrorPayload | null;
  wasClosed: boolean;
  initialRoomId?: string;
  onJoin: (roomId: string, stageName: string, password?: string, isCreator?: boolean) => void;
  onCreateRoom: (
    roomName: string,
    isPrivate: boolean,
    password?: string,
  ) => Promise<ChatRoomSummary>;
}

type Tab = 'create' | 'join';

const randomStageNamePlaceholder = 'Wild Wolf';

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 14px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  boxSizing: 'border-box',
  fontSize: 14,
  fontFamily: theme.font.body,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: theme.color.textSecondary,
  marginBottom: 6,
  marginTop: 16,
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '12px 24px',
  borderRadius: theme.radius.pill,
  border: 'none',
  background: disabled ? theme.color.border : theme.color.accent,
  color: '#fff',
  fontWeight: 700,
  cursor: disabled ? 'default' : 'pointer',
});

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 16px',
    borderRadius: theme.radius.pill,
    border: 'none',
    background: active ? theme.color.accent : 'transparent',
    color: active ? '#fff' : theme.color.textSecondary,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function choiceCardStyle(active: boolean): React.CSSProperties {
  return {
    flex: '1 1 140px',
    padding: 14,
    borderRadius: theme.radius.md,
    border: `1.5px solid ${active ? theme.color.accent : theme.color.border}`,
    background: active ? theme.color.accentSoft : theme.color.panel,
    cursor: 'pointer',
    textAlign: 'left',
  };
}

export default function ChatLanding({
  isSocketConnected,
  isJoining,
  joinError,
  wasClosed,
  initialRoomId,
  onJoin,
  onCreateRoom,
}: ChatLandingProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialRoomId ? 'join' : 'create');

  // Create tab state
  const [roomName, setRoomName] = useState('');
  const [createStageName, setCreateStageName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErrorMsg, setCreateErrorMsg] = useState('');

  // Join tab state
  const [joinRoomId, setJoinRoomId] = useState(initialRoomId ?? '');
  const [joinStageName, setJoinStageName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinRoomInfo, setJoinRoomInfo] = useState<ChatRoomSummary | null>(null);

  // Looks up the room as the user types its ID, so we only ask for a password when
  // the room actually is private, instead of always showing an unconditional field.
  // Render-time code below only trusts joinRoomInfo when its roomId still matches the
  // current input, so stale results from a since-edited ID are simply ignored rather
  // than needing to be eagerly cleared here.
  useEffect(() => {
    const id = joinRoomId.trim();
    if (!id) return;
    const timer = setTimeout(() => {
      fetchChatRoom(id)
        .then(setJoinRoomInfo)
        .catch(() => setJoinRoomInfo(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [joinRoomId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErrorMsg('');
    setCreating(true);
    try {
      const room = await onCreateRoom(roomName, isPrivate, isPrivate ? createPassword : undefined);
      const stageName = createStageName.trim() || randomStageName();
      onJoin(room.roomId, stageName, isPrivate ? createPassword : undefined, true);
    } catch (err) {
      setCreateErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinRoomId.trim() || !joinStageName.trim()) return;
    onJoin(joinRoomId, joinStageName, joinPassword || undefined);
  };

  const handlePasteRoomId = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setJoinRoomId(text.trim());
    } catch {
      // Clipboard read denied/unavailable - user can still type the ID manually.
    }
  };

  const busy = activeTab === 'create' ? creating || isJoining : isJoining;

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: '32px auto',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0,
        fontFamily: theme.font.body,
        background: theme.color.background,
        borderRadius: theme.radius.md,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, padding: 32, minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: theme.color.accent,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: theme.font.heading,
              fontWeight: 700,
            }}
          >
            A
          </span>
          <strong style={{ fontSize: 16 }}>AirBond Chat</strong>
        </div>

        <h1 style={{ fontFamily: theme.font.heading, fontSize: 34, margin: '0 0 12px', lineHeight: 1.15 }}>
          Rooms that close when you leave.
        </h1>
        <p style={{ color: theme.color.textSecondary, fontSize: 15, lineHeight: 1.5 }}>
          Spin up a room, share the ID, talk. Nothing is stored once the room expires.
        </p>

        <ol style={{ listStyle: 'none', padding: 0, marginTop: 24 }}>
          {[
            'Name the room and pick who can walk in.',
            'Send the room ID to your people.',
            'Room and messages disappear after two hours.',
          ].map((step, i) => (
            <li key={step} style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: theme.color.successSoft,
                  color: theme.color.success,
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14, color: theme.color.textPrimary }}>{step}</span>
            </li>
          ))}
        </ol>

        <div
          style={{
            marginTop: 24,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: theme.radius.pill,
            background: theme.color.panel,
            fontSize: 13,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isSocketConnected ? theme.color.success : '#bbb',
            }}
          />
          Signaling {isSocketConnected ? 'connected' : 'offline'}
        </div>
      </div>

      <div style={{ flex: 1, padding: 32, background: theme.color.panel, minWidth: 320 }}>
        {wasClosed && (
          <p
            style={{
              background: theme.color.accentSoft,
              color: theme.color.accentHover,
              padding: 10,
              borderRadius: theme.radius.sm,
              fontSize: 13,
            }}
          >
            Your previous chat room expired after 2 hours.
          </p>
        )}

        <div style={{ display: 'flex', gap: 4, background: theme.color.panelAlt, borderRadius: theme.radius.pill, padding: 4 }}>
          <button type="button" style={tabButtonStyle(activeTab === 'create')} onClick={() => setActiveTab('create')}>
            Create a room
          </button>
          <button type="button" style={tabButtonStyle(activeTab === 'join')} onClick={() => setActiveTab('join')}>
            Join a room
          </button>
        </div>

        {activeTab === 'create' ? (
          <form onSubmit={handleCreate}>
            <label style={labelStyle} htmlFor="create-room-name">
              ROOM NAME
            </label>
            <input
              id="create-room-name"
              style={inputStyle}
              placeholder="Design standup"
              value={roomName}
              maxLength={60}
              onChange={(e) => setRoomName(e.target.value)}
              required
            />

            <label style={labelStyle} htmlFor="create-stage-name">
              YOUR STAGE NAME
            </label>
            <input
              id="create-stage-name"
              style={inputStyle}
              placeholder={randomStageNamePlaceholder}
              value={createStageName}
              maxLength={30}
              onChange={(e) => setCreateStageName(e.target.value)}
            />
            <p style={{ fontSize: 12, color: theme.color.textSecondary, margin: '4px 0 0' }}>
              Shown on your messages. Leave it blank and we'll give you one.
            </p>

            <label style={labelStyle}>WHO CAN JOIN</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" style={choiceCardStyle(!isPrivate)} onClick={() => setIsPrivate(false)}>
                <strong style={{ display: 'block', fontSize: 14 }}>🌐 Public</strong>
                <span style={{ fontSize: 12, color: theme.color.textSecondary }}>
                  Anyone with the room ID walks straight in.
                </span>
              </button>
              <button type="button" style={choiceCardStyle(isPrivate)} onClick={() => setIsPrivate(true)}>
                <strong style={{ display: 'block', fontSize: 14 }}>🔒 Private</strong>
                <span style={{ fontSize: 12, color: theme.color.textSecondary }}>
                  ID plus a password you set below.
                </span>
              </button>
            </div>

            {isPrivate && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  background: theme.color.accentSoft,
                  borderRadius: theme.radius.md,
                }}
              >
                <label style={{ ...labelStyle, marginTop: 0 }} htmlFor="create-password">
                  ROOM PASSWORD
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    id="create-password"
                    style={{ ...inputStyle, background: '#fff' }}
                    type={showCreatePassword ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    value={createPassword}
                    minLength={4}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((v) => !v)}
                    style={{ padding: '0 14px', borderRadius: theme.radius.pill, border: `1px solid ${theme.color.border}`, background: '#fff', cursor: 'pointer' }}
                  >
                    {showCreatePassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: theme.color.textSecondary, margin: '6px 0 0' }}>
                  Everyone joining must type this password. It isn't recoverable — share it yourself.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
              <button type="submit" disabled={busy || !isSocketConnected} style={primaryButtonStyle(busy || !isSocketConnected)}>
                {busy ? 'Creating...' : 'Create room'}
              </button>
              <span style={{ fontSize: 12, color: theme.color.textSecondary }}>
                {isPrivate ? 'Password required to join' : 'Open to anyone with the ID'}
              </span>
            </div>
            {createErrorMsg && <p style={{ color: theme.color.danger, fontSize: 13 }}>{createErrorMsg}</p>}
            {joinError && <p style={{ color: theme.color.danger, fontSize: 13 }}>{joinError.message}</p>}
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <label style={labelStyle} htmlFor="join-room-id">
              ROOM ID
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="join-room-id"
                style={inputStyle}
                placeholder="4389eef9"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={handlePasteRoomId}
                style={{ padding: '0 14px', borderRadius: theme.radius.pill, border: `1px solid ${theme.color.border}`, background: '#fff', cursor: 'pointer' }}
              >
                Paste
              </button>
            </div>

            <label style={labelStyle} htmlFor="join-stage-name">
              YOUR STAGE NAME
            </label>
            <input
              id="join-stage-name"
              style={inputStyle}
              placeholder={randomStageNamePlaceholder}
              value={joinStageName}
              maxLength={30}
              onChange={(e) => setJoinStageName(e.target.value)}
              required
            />

            {joinRoomInfo?.roomId === joinRoomId.trim() && joinRoomInfo.isPrivate && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  background: theme.color.accentSoft,
                  borderRadius: theme.radius.md,
                }}
              >
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>🔒 This room is private</p>
                <input
                  style={{ ...inputStyle, background: '#fff' }}
                  type="password"
                  placeholder="Room password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  required
                />
                <p style={{ fontSize: 11, color: theme.color.textSecondary, margin: '6px 0 0' }}>
                  Ask the person who created the room for it.
                </p>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <button type="submit" disabled={busy || !isSocketConnected} style={primaryButtonStyle(busy || !isSocketConnected)}>
                {busy ? 'Joining...' : 'Join room'}
              </button>
            </div>
            {joinError && <p style={{ color: theme.color.danger, fontSize: 13 }}>{joinError.message}</p>}
          </form>
        )}

        <p style={{ marginTop: 28, fontSize: 12, color: theme.color.textSecondary }}>
          Relayed live through our signaling server. Never stored.
        </p>
      </div>
    </div>
  );
}
