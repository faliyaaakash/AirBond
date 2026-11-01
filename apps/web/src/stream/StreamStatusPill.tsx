import { useLocation, useNavigate } from 'react-router-dom';
import { theme } from '../theme';
import Badge from '../components/Badge';
import { useStreamSessionContext } from './StreamSessionContext';

// A tiny, video-free affordance shown on every page except the stream room
// itself, while a stream is live/being watched in this tab. Since Picture-
// in-Picture is the actual "watch from anywhere" mechanism (see
// StreamSessionContext), this pill's job is just to make that reachable from
// wherever the user wandered off to - not to render its own video preview.
export default function StreamStatusPill() {
  const { role, roomId, viewerCount, isPipSupported, isInPictureInPicture, requestPip } = useStreamSessionContext();
  const location = useLocation();
  const navigate = useNavigate();

  const onStreamRoute = location.pathname === '/stream' || location.pathname.startsWith('/stream/room/');
  if (role === 'none' || onStreamRoute) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: theme.color.panel,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.pill,
        boxShadow: '0 6px 20px rgba(43, 33, 24, 0.18)',
        padding: '8px 10px 8px 16px',
        fontFamily: theme.font.body,
      }}
    >
      <Badge tone="success" dot>
        {role === 'broadcaster' ? 'LIVE' : 'WATCHING'}
      </Badge>
      <span style={{ fontSize: 12, color: theme.color.textSecondary, whiteSpace: 'nowrap' }}>
        {viewerCount} watching
      </span>
      {isPipSupported && (
        <button
          type="button"
          onClick={requestPip}
          style={{
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius.pill,
            background: isInPictureInPicture ? theme.color.accentSoft : 'transparent',
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            color: theme.color.textPrimary,
            whiteSpace: 'nowrap',
          }}
        >
          {isInPictureInPicture ? '⧉ Floating' : '⧉ Pop out'}
        </button>
      )}
      <button
        type="button"
        onClick={() => navigate(`/stream/room/${roomId}`)}
        style={{
          border: 'none',
          borderRadius: theme.radius.pill,
          background: theme.color.accent,
          color: '#fff',
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Return
      </button>
    </div>
  );
}
