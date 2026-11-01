import { useState } from 'react';
import type { StreamJoinErrorPayload, StreamJoinSource, StreamSummary } from '@airbond/shared';
import { theme } from '../theme';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import CopyButton from '../components/CopyButton';
import { randomStageName } from '../chat/randomStageName';
import type { MediaErrorInfo } from './mediaError';
import { isLikelyIOS } from './mediaError';
import PermissionDeniedHelp from '../components/PermissionDeniedHelp';

interface StreamLandingProps {
  streams: StreamSummary[];
  isSocketConnected: boolean;
  creating: boolean;
  joining: boolean;
  joinError: StreamJoinErrorPayload | null;
  mediaError: MediaErrorInfo | null;
  notice: string | null;
  initialRoomId?: string;
  onCreateStream: (title: string, isPrivate: boolean, password?: string) => void;
  onJoinStream: (roomId: string, displayName: string, password: string | undefined, joinSource: StreamJoinSource) => void;
}

// The insecure-context fix differs by platform: Android Chrome has a flag
// that works exactly like desktop Chrome's; iOS (Safari, and Chrome-for-iOS
// which is Safari's engine underneath) has no equivalent at all, so pointing
// an iPhone user at chrome://flags would just be a dead end.
function InsecureContextHelp() {
  const origin = window.location.origin;

  if (isLikelyIOS()) {
    return (
      <p style={{ color: theme.color.danger, fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
        iOS (Safari, and Chrome on iOS - same engine underneath) has no setting that can bypass this.
        Camera access here requires the page to actually be served over HTTPS, or you can test from a
        desktop browser in the meantime.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ color: theme.color.danger, fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        On Chrome (desktop or Android): open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>,
        paste this page's address into the box, enable it, then relaunch Chrome.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <code style={{ fontSize: 12, background: theme.color.panelAlt, padding: '4px 8px', borderRadius: theme.radius.sm }}>
          {origin}
        </code>
        <CopyButton value={origin} label="Copy address" />
      </div>
    </div>
  );
}

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

export default function StreamLanding({
  streams,
  isSocketConnected,
  creating,
  joining,
  joinError,
  mediaError,
  notice,
  initialRoomId,
  onCreateStream,
  onJoinStream,
}: StreamLandingProps) {
  const [displayName, setDisplayName] = useState(randomStageName());
  const [title, setTitle] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');

  const [joinRoomId, setJoinRoomId] = useState(initialRoomId ?? '');
  const [joinPassword, setJoinPassword] = useState('');
  const [passwordPromptFor, setPasswordPromptFor] = useState<string | null>(null);
  const [listPassword, setListPassword] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateStream(title.trim(), isPrivate, isPrivate ? createPassword : undefined);
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinRoomId.trim() || !displayName.trim()) return;
    onJoinStream(joinRoomId, displayName, joinPassword || undefined, 'code');
  };

  const handleSelectStream = (stream: StreamSummary) => {
    if (!displayName.trim()) return;
    if (!stream.isPrivate) {
      onJoinStream(stream.roomId, displayName, undefined, 'discovery');
      return;
    }
    if (passwordPromptFor === stream.roomId) {
      onJoinStream(stream.roomId, displayName, listPassword || undefined, 'discovery');
    } else {
      setPasswordPromptFor(stream.roomId);
      setListPassword('');
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 30 }}>Live Stream</h1>
        <Badge tone={isSocketConnected ? 'success' : 'neutral'} dot>
          {isSocketConnected ? 'Signaling connected' : 'Signaling offline'}
        </Badge>
      </div>
      <p style={{ color: theme.color.textSecondary, fontSize: 14, marginTop: 6 }}>
        Broadcast your camera or screen straight to viewers over WebRTC, with live speech-to-text
        captions. Nothing is recorded or stored — the stream disappears the moment it ends.
      </p>

      {notice && (
        <p
          style={{
            background: theme.color.accentSoft,
            color: theme.color.accentHover,
            padding: 10,
            borderRadius: theme.radius.sm,
            fontSize: 13,
            marginTop: 12,
          }}
        >
          {notice}
        </p>
      )}

      <Card style={{ marginTop: 20 }}>
        <label style={{ ...labelStyle, marginTop: 0 }} htmlFor="stream-display-name">
          YOUR DISPLAY NAME
        </label>
        <input
          id="stream-display-name"
          style={inputStyle}
          maxLength={30}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <p style={{ fontSize: 12, color: theme.color.textSecondary, margin: '6px 0 0' }}>
          Shown on your chat messages and reactions.
        </p>
      </Card>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>Start a stream</h3>
          <form onSubmit={handleCreate}>
            <label style={{ ...labelStyle, marginTop: 0 }} htmlFor="stream-title">
              TITLE
            </label>
            <input
              id="stream-title"
              style={inputStyle}
              placeholder="Design review walkthrough"
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />

            <label style={labelStyle}>VISIBILITY</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  border: `1.5px solid ${!isPrivate ? theme.color.accent : theme.color.border}`,
                  background: !isPrivate ? theme.color.accentSoft : theme.color.panel,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <strong style={{ display: 'block', fontSize: 13 }}>🌐 Public</strong>
                <span style={{ fontSize: 11, color: theme.color.textSecondary }}>Listed for anyone browsing</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  border: `1.5px solid ${isPrivate ? theme.color.accent : theme.color.border}`,
                  background: isPrivate ? theme.color.accentSoft : theme.color.panel,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <strong style={{ display: 'block', fontSize: 13 }}>🔒 Private</strong>
                <span style={{ fontSize: 11, color: theme.color.textSecondary }}>Listed, password required</span>
              </button>
            </div>

            {isPrivate && (
              <>
                <label style={labelStyle} htmlFor="stream-password">
                  PASSWORD
                </label>
                <input
                  id="stream-password"
                  style={inputStyle}
                  type="password"
                  placeholder="At least 4 characters"
                  minLength={4}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  required
                />
              </>
            )}

            <div style={{ marginTop: 18 }}>
              <Button type="submit" disabled={creating || !isSocketConnected || !title.trim()}>
                {creating ? 'Starting...' : 'Go live'}
              </Button>
            </div>
            {mediaError && (
              <>
                <p style={{ color: theme.color.danger, fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>{mediaError.message}</p>
                {mediaError.code === 'insecure-context' && <InsecureContextHelp />}
                {mediaError.code === 'permission-denied' && <PermissionDeniedHelp />}
              </>
            )}
          </form>
        </Card>

        <Card style={{ flex: '1 1 260px' }}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>Join by code</h3>
          <form onSubmit={handleJoinByCode}>
            <label style={{ ...labelStyle, marginTop: 0 }} htmlFor="join-stream-id">
              ROOM ID
            </label>
            <input
              id="join-stream-id"
              style={inputStyle}
              placeholder="4389eef9"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              required
            />
            <label style={labelStyle} htmlFor="join-stream-password">
              PASSWORD (IF PRIVATE)
            </label>
            <input
              id="join-stream-password"
              style={inputStyle}
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
            />
            <div style={{ marginTop: 18 }}>
              <Button
                type="submit"
                variant="secondary"
                disabled={joining || !isSocketConnected || !joinRoomId.trim() || !displayName.trim()}
              >
                {joining ? 'Joining...' : 'Join'}
              </Button>
            </div>
            {joinError && <p style={{ color: theme.color.danger, fontSize: 13, marginTop: 8 }}>{joinError.message}</p>}
          </form>
        </Card>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 28, marginBottom: 10 }}>Live now</h2>
      {streams.length === 0 ? (
        <Card>
          <p style={{ fontSize: 13, color: theme.color.textSecondary, margin: 0 }}>
            Nobody is streaming right now — start one above.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {streams.map((stream) => (
            <Card key={stream.roomId} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {stream.isPrivate ? <Badge tone="accent">PRIVATE</Badge> : <Badge tone="success">PUBLIC</Badge>}
                  <strong style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stream.title}
                  </strong>
                  <span style={{ fontSize: 12, color: theme.color.textSecondary, whiteSpace: 'nowrap' }}>
                    {stream.viewerCount} watching
                  </span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => handleSelectStream(stream)}
                  disabled={joining || !displayName.trim()}
                  style={{ padding: '8px 18px', fontSize: 13 }}
                >
                  {stream.isPrivate ? 'Unlock & watch' : 'Watch'}
                </Button>
              </div>

              {passwordPromptFor === stream.roomId && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    type="password"
                    placeholder="Stream password"
                    value={listPassword}
                    onChange={(e) => setListPassword(e.target.value)}
                    autoFocus
                  />
                  <Button onClick={() => handleSelectStream(stream)} disabled={joining} style={{ padding: '8px 18px', fontSize: 13 }}>
                    Watch
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
