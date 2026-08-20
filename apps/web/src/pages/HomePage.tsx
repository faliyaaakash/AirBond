import { theme } from '../theme';
import Badge from '../components/Badge';
import Card from '../components/Card';
import LinkButton from '../components/LinkButton';

const WHY_ITS_DIFFERENT = [
  'No accounts, no sign-up — a room ID is all you need.',
  "Files transfer directly between browsers (WebRTC) — our server helps two peers find each other, then gets out of the way and never sees file contents.",
  'Chat messages relay live through our signaling server so features like typing indicators and join notifications work properly — but they\'re never written to a database. Once you close the tab, they\'re gone.',
  'Chat rooms auto-expire 2 hours after creation, no exceptions.',
  'Private chat rooms are password-protected; the password is hashed and never stored in plain text.',
];

export default function HomePage() {
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      {/* Hero */}
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center', paddingTop: 24 }}>
        <div style={{ flex: '1 1 420px', minWidth: 280 }}>
          <Badge tone="accent">NO ACCOUNTS, EVER</Badge>
          <h1 style={{ fontSize: 48, margin: '14px 0 12px', lineHeight: 1.05 }}>AirBond</h1>
          <p style={{ color: theme.color.textSecondary, fontSize: 16, lineHeight: 1.6, maxWidth: 480 }}>
            Account-free tools for sharing files and talking in real time — nothing to sign up
            for, nothing left behind afterward.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <LinkButton to="/chat" variant="primary">
              Open Chat
            </LinkButton>
            <LinkButton to="/files" variant="secondary">
              Open File Share
            </LinkButton>
          </div>
        </div>

        <div style={{ flex: '0 0 260px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 240, height: 240 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: theme.color.successSoft,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 24,
                borderRadius: '50%',
                border: `1.5px dashed ${theme.color.success}`,
                opacity: 0.5,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 44,
                left: -8,
                background: theme.color.panel,
                border: `1px solid ${theme.color.border}`,
                borderRadius: theme.radius.pill,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 4px 10px rgba(0,0,0,0.06)',
              }}
            >
              room open · 2h
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: 50,
                right: -12,
                background: theme.color.accentSoft,
                color: theme.color.accentHover,
                borderRadius: theme.radius.pill,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              then gone
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${theme.color.border}`, margin: '36px 0' }} />

      {/* Why it's different */}
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 220px' }}>
          <h2 style={{ fontSize: 26, lineHeight: 1.2 }}>Why it's different</h2>
        </div>
        <ol style={{ flex: '1 1 420px', minWidth: 280, listStyle: 'none', padding: 0, margin: 0 }}>
          {WHY_ITS_DIFFERENT.map((item, i) => (
            <li key={item} style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: theme.color.accentSoft,
                  color: theme.color.accentHover,
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14.5, color: theme.color.textPrimary, lineHeight: 1.55 }}>{item}</span>
            </li>
          ))}
        </ol>
      </div>

      <div style={{ borderTop: `1px solid ${theme.color.border}`, margin: '36px 0' }} />

      {/* Feature cards */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Card style={{ flex: '1 1 320px', minWidth: 260, background: theme.color.panelAlt }}>
          <span
            style={{
              display: 'inline-flex',
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: theme.color.successSoft,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              marginBottom: 12,
            }}
          >
            ⬆
          </span>
          <h3 style={{ fontSize: 19, marginBottom: 8 }}>File Share</h3>
          <p style={{ color: theme.color.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            Create a room, share the ID, and drop files in — they stream directly to everyone
            connected over a peer-to-peer WebRTC data channel.
          </p>
          <LinkButton to="/files" variant="secondary" style={{ padding: '8px 18px', fontSize: 13 }}>
            Open File Share
          </LinkButton>
        </Card>

        <Card style={{ flex: '1 1 320px', minWidth: 260, background: theme.color.panelAlt }}>
          <span
            style={{
              display: 'inline-flex',
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: theme.color.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              marginBottom: 12,
            }}
          >
            💬
          </span>
          <h3 style={{ fontSize: 19, marginBottom: 8 }}>Chat</h3>
          <p style={{ color: theme.color.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            Spin up a room (public or password-protected), pick a stage name, and talk. Rooms
            and messages disappear automatically after 2 hours.
          </p>
          <LinkButton to="/chat" variant="primary" style={{ padding: '8px 18px', fontSize: 13 }}>
            Open Chat
          </LinkButton>
        </Card>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 36,
          paddingTop: 16,
          borderTop: `1px solid ${theme.color.border}`,
          fontSize: 12,
          color: theme.color.textSecondary,
        }}
      >
        <span>Files transfer peer-to-peer. Chat messages relay live and are never stored.</span>
        <span>Rooms auto-expire · 2 hours</span>
      </div>
    </div>
  );
}
