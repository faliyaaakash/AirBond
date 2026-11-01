import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { StreamSessionProvider } from './stream/StreamSessionContext';
import StreamStatusPill from './stream/StreamStatusPill';
import { theme } from './theme';

// Code-split per route - each of these (and everything they pull in, e.g.
// FileSharePage's OPFS worker/IndexedDB machinery, or the dashboard's chart)
// used to load eagerly as part of the very first page's bundle regardless of
// which route you actually landed on, which is the main reason first load
// felt slow. Only HomePage (the common landing route) stays a normal eager
// import - everything else now loads on first visit to that route instead.
const FileSharePage = lazy(() => import('./webrtc/FileSharePage'));
const ChatPage = lazy(() => import('./chat/ChatPage'));
const StreamPage = lazy(() => import('./stream/StreamPage'));
const CallPage = lazy(() => import('./call/CallPage'));
const DashboardPage = lazy(() => import('./dashboard/DashboardPage'));

const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: theme.radius.pill,
  textDecoration: 'none',
  color: isActive ? '#fff' : theme.color.textSecondary,
  background: isActive ? theme.color.accent : 'transparent',
  fontWeight: 600,
  fontSize: 14,
});

// Only ever visible for the brief moment a lazy route's chunk is still being
// fetched/parsed (near-instant on a production build, a bit more noticeable
// over a slow tunnel in dev) - never on the very first paint, since that's
// HomePage, which isn't lazy.
function RouteLoadingFallback() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: theme.color.textSecondary, fontFamily: theme.font.body }}>
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <StreamSessionProvider>
      <div style={{ background: theme.color.background, minHeight: '100svh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '20px 20px 0' }}>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            background: theme.color.panel,
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius.pill,
            padding: '10px 16px',
            fontFamily: theme.font.body,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: theme.color.accent,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: theme.font.heading,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              A
            </span>
            <strong style={{ fontFamily: theme.font.heading, fontSize: 16, color: theme.color.textPrimary }}>
              AirBond
            </strong>
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <NavLink to="/" end style={navLinkStyle}>
              Home
            </NavLink>
            <NavLink to="/files" style={navLinkStyle}>
              File Share
            </NavLink>
            <NavLink to="/chat" style={navLinkStyle}>
              Chat
            </NavLink>
            <NavLink to="/stream" style={navLinkStyle}>
              Live Stream
            </NavLink>
            <NavLink to="/call" style={navLinkStyle}>
              Video Call
            </NavLink>
            <NavLink to="/dashboard" style={navLinkStyle}>
              Dashboard
            </NavLink>
          </div>
        </nav>
      </div>

      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/files" element={<FileSharePage />} />
          <Route path="/files/room/:roomId" element={<FileSharePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/room/:roomId" element={<ChatPage />} />
          <Route path="/stream" element={<StreamPage />} />
          <Route path="/stream/room/:roomId" element={<StreamPage />} />
          <Route path="/call" element={<CallPage />} />
          <Route path="/call/room/:roomId" element={<CallPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </Suspense>

      <StreamStatusPill />
      </div>
    </StreamSessionProvider>
  );
}
