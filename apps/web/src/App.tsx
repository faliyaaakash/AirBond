import { NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import FileSharePage from './webrtc/FileSharePage';
import ChatPage from './chat/ChatPage';
import DashboardPage from './dashboard/DashboardPage';
import { theme } from './theme';

const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: theme.radius.pill,
  textDecoration: 'none',
  color: isActive ? '#fff' : theme.color.textSecondary,
  background: isActive ? theme.color.accent : 'transparent',
  fontWeight: 600,
  fontSize: 14,
});

export default function App() {
  return (
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
            <NavLink to="/dashboard" style={navLinkStyle}>
              Dashboard
            </NavLink>
          </div>
        </nav>
      </div>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/files" element={<FileSharePage />} />
        <Route path="/files/room/:roomId" element={<FileSharePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/room/:roomId" element={<ChatPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
