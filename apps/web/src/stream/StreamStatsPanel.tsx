import { useEffect, useState } from 'react';
import type { VideoSource } from '@airbond/shared';
import { theme } from '../theme';
import Badge from '../components/Badge';
import type { ConnectionType } from '../webrtc/connectionType';

interface StreamStatsPanelProps {
  role: 'broadcaster' | 'viewer';
  streamStartedAt: number | null;
  viewerCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
  viewerConnectionType: ConnectionType;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function connectionTypeLabel(type: ConnectionType): { text: string; tone: 'success' | 'accent' | 'neutral' } {
  if (type === 'direct') return { text: 'DIRECT P2P', tone: 'success' };
  if (type === 'relay') return { text: 'RELAYED (TURN)', tone: 'accent' };
  return { text: 'NEGOTIATING…', tone: 'neutral' };
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 13,
  padding: '8px 0',
  borderBottom: `1px solid ${theme.color.border}`,
};

// Read-only telemetry, all built from data the session already has (or
// trivially derives) - no extra server round-trips.
export default function StreamStatsPanel({
  role,
  streamStartedAt,
  viewerCount,
  micEnabled,
  cameraEnabled,
  videoSource,
  viewerConnectionType,
}: StreamStatsPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = streamStartedAt ? formatDuration(now - streamStartedAt) : '—';
  const connectionLabel = connectionTypeLabel(viewerConnectionType);

  return (
    <div style={{ padding: '4px 14px' }}>
      <div style={rowStyle}>
        <span style={{ color: theme.color.textSecondary }}>
          {role === 'broadcaster' ? 'STREAM DURATION' : 'WATCHING FOR'}
        </span>
        <strong>{elapsed}</strong>
      </div>
      <div style={rowStyle}>
        <span style={{ color: theme.color.textSecondary }}>VIEWERS</span>
        <strong>{viewerCount}</strong>
      </div>
      {role === 'broadcaster' && (
        <>
          <div style={rowStyle}>
            <span style={{ color: theme.color.textSecondary }}>MICROPHONE</span>
            <Badge tone={micEnabled ? 'success' : 'neutral'}>{micEnabled ? 'ON' : 'MUTED'}</Badge>
          </div>
          <div style={rowStyle}>
            <span style={{ color: theme.color.textSecondary }}>CAMERA</span>
            <Badge tone={cameraEnabled ? 'success' : 'neutral'}>{cameraEnabled ? 'ON' : 'OFF'}</Badge>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={{ color: theme.color.textSecondary }}>SOURCE</span>
            <Badge tone="accent">{videoSource === 'screen' ? 'SCREEN' : 'CAMERA'}</Badge>
          </div>
        </>
      )}
      {role === 'viewer' && (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={{ color: theme.color.textSecondary }}>YOUR CONNECTION</span>
          <Badge tone={connectionLabel.tone}>{connectionLabel.text}</Badge>
        </div>
      )}
    </div>
  );
}
