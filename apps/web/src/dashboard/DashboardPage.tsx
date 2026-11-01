import { theme } from '../theme';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { formatBytes, formatSpeed } from '../webrtc/formatBytes';
import { useDashboardSocket } from './useDashboardSocket';
import PasscodeGate from './PasscodeGate';
import LiveChart from './LiveChart';
import type { ConnectionType } from '@airbond/shared';

function connectionTypeLabel(type: ConnectionType): { text: string; tone: 'success' | 'accent' | 'neutral' } {
  if (type === 'direct') return { text: 'DIRECT P2P', tone: 'success' };
  if (type === 'relay') return { text: 'RELAYED (TURN)', tone: 'accent' };
  return { text: 'NEGOTIATING…', tone: 'neutral' };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds}s`;
}

const statCardStyle: React.CSSProperties = {
  flex: '1 1 160px',
  padding: 16,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  color: theme.color.textSecondary,
  padding: '6px 10px',
  borderBottom: `1px solid ${theme.color.border}`,
};

const tdStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  borderBottom: `1px solid ${theme.color.border}`,
};

export default function DashboardPage() {
  const { authenticated, authError, connecting, snapshot, submitCode, signOut } = useDashboardSocket();

  if (!authenticated || !snapshot) {
    return <PasscodeGate error={authError} connecting={connecting} onSubmit={submitCode} />;
  }

  const bucketSeconds =
    snapshot.traffic.length > 1
      ? (new Date(snapshot.traffic[1].bucketStart).getTime() -
          new Date(snapshot.traffic[0].bucketStart).getTime()) /
        1000
      : 5;

  const fileThroughputPoints = snapshot.traffic.map((p) => p.fileBytes / bucketSeconds);
  const chatRatePoints = snapshot.traffic.map((p) => p.chatMessages / (bucketSeconds / 60));

  // Durations are computed relative to when the snapshot was generated (server
  // time embedded in the data), not the render time, so this stays pure.
  const now = new Date(snapshot.generatedAt).getTime();

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 28 }}>Live Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: theme.color.textSecondary }}>
            Updated {new Date(snapshot.generatedAt).toLocaleTimeString()}
          </span>
          <Button variant="secondary" onClick={signOut} style={{ padding: '6px 16px', fontSize: 13 }}>
            Sign out
          </Button>
        </div>
      </div>

      <Card style={{ marginTop: 16, background: theme.color.panelAlt }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>How this works</h3>
        <p style={{ fontSize: 13, color: theme.color.textSecondary, lineHeight: 1.6, marginBottom: 6 }}>
          <strong>File Share</strong> is peer-to-peer over WebRTC — file bytes never pass through this
          server. Clients only report a small metadata ping (filename, size, bytes-so-far) so this
          dashboard can show progress; the file content itself is never received or stored here.
          A receiver also pings when its own local disk write falls behind the incoming data (shown
          as <strong>Disk backpressure</strong> below) — the sender pauses automatically until it
          catches up, so a slow phone/drive can't corrupt a transfer by losing chunks.
        </p>
        <p style={{ fontSize: 13, color: theme.color.textSecondary, lineHeight: 1.6, marginBottom: 6 }}>
          <strong>Chat</strong> messages are relayed live through this server (so join/typing/reactions
          work), but are never written to a database — only a message <em>count</em> is tracked below,
          never message text. The traffic graph itself lives in Redis with a 15-minute rolling window,
          then auto-expires.
        </p>
        <p style={{ fontSize: 13, color: theme.color.textSecondary, lineHeight: 1.6 }}>
          <strong>Live Stream</strong> video/audio goes straight from the broadcaster's browser to each
          viewer over WebRTC — this server never receives it. The table below shows, per stream, how
          many viewers actually connected direct P2P vs. needed a TURN relay, plus the real signaling
          bytes this server processed (handshake, captions, chat) against how long the stream has run.
        </p>
      </Card>

      <Card style={{ marginTop: 16, borderColor: theme.color.accent }}>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>The proof: what this server actually received</h3>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: theme.color.textSecondary }}>P2P FILE DATA (CLIENT-REPORTED)</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: theme.color.textPrimary }}>
              {formatBytes(snapshot.totals.totalFileBytesTracked)}
            </div>
          </div>
          <div style={{ fontSize: 22, color: theme.color.textSecondary, paddingBottom: 4 }}>vs</div>
          <div>
            <div style={{ fontSize: 11, color: theme.color.textSecondary }}>SIGNALING BYTES RECEIVED HERE</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: theme.color.accentHover }}>
              {formatBytes(snapshot.totals.totalSignalingBytesTracked)}
            </div>
          </div>
          {snapshot.totals.totalSignalingBytesTracked > 0 && snapshot.totals.totalFileBytesTracked > 0 && (
            <div style={{ paddingBottom: 4 }}>
              <Badge tone="accent">
                {Math.round(
                  snapshot.totals.totalFileBytesTracked / snapshot.totals.totalSignalingBytesTracked,
                )}
                × more data moved directly between peers than ever touched this server
              </Badge>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 10, marginBottom: 0 }}>
          "Signaling bytes" is the real, measured size of every WebRTC handshake message, progress ping,
          and chat message this server has processed since it started — see the live log below.
        </p>
      </Card>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>ACTIVE FILE ROOMS</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.activeFileRooms}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>ACTIVE CHAT ROOMS</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.activeChatRooms}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>FILE PEERS CONNECTED</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.connectedFilePeers}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>CHAT PARTICIPANTS</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.connectedChatPeers}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>TOTAL BYTES REPORTED</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{formatBytes(snapshot.totals.totalFileBytesTracked)}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>TOTAL MESSAGES RELAYED</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.totalChatMessagesTracked}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>ACTIVE LIVE STREAMS</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.activeStreamRooms}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>STREAM VIEWERS CONNECTED</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.connectedStreamViewers}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>CAPTIONS RELAYED</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.totalCaptionsTracked}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>STREAM CHAT MESSAGES</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.totalStreamChatMessagesTracked}</div>
        </Card>
        <Card style={statCardStyle}>
          <div style={{ fontSize: 11, color: theme.color.textSecondary }}>STREAM JOINS VIA SHARED LINK</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{snapshot.totals.totalStreamLinkJoinsTracked}</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: '1 1 400px' }}>
          <LiveChart
            points={fileThroughputPoints}
            color={theme.color.accent}
            label="File transfer throughput (peer-to-peer, reported)"
            formatValue={formatSpeed}
          />
        </Card>
        <Card style={{ flex: '1 1 400px' }}>
          <LiveChart
            points={chatRatePoints}
            color={theme.color.success}
            label="Chat messages relayed (per minute)"
            formatValue={(v) => `${v.toFixed(1)}/min`}
          />
        </Card>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Live wire log</h2>
      <Card padded={false}>
        {snapshot.recentEvents.length === 0 ? (
          <p style={{ padding: 16, fontSize: 13, color: theme.color.textSecondary }}>
            No signaling activity yet.
          </p>
        ) : (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>TIME</th>
                  <th style={thStyle}>EVENT RECEIVED</th>
                  <th style={thStyle}>ROOM</th>
                  <th style={thStyle}>PAYLOAD SIZE</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentEvents.map((entry) => (
                  <tr key={entry.id}>
                    <td style={tdStyle}>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                    <td style={tdStyle}>
                      <code>{entry.event}</code>
                    </td>
                    <td style={tdStyle}>{entry.roomId ? <code>{entry.roomId}</code> : '—'}</td>
                    <td style={tdStyle}>{entry.sizeBytes} B</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Active file-share rooms</h2>
      <Card padded={false}>
        {snapshot.fileRooms.length === 0 ? (
          <p style={{ padding: 16, fontSize: 13, color: theme.color.textSecondary }}>No active rooms.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ROOM ID</th>
                <th style={thStyle}>PEERS</th>
                <th style={thStyle}>CONNECTION</th>
                <th style={thStyle}>ACTIVE TRANSFERS</th>
                <th style={thStyle}>DISK BACKPRESSURE</th>
                <th style={thStyle}>AGE</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.fileRooms.map((room) => {
                const connLabel = connectionTypeLabel(room.connectionType);
                const backpressured = room.activeTransfers.filter(
                  (t) => t.direction === 'receive' && t.backpressureEngaged,
                );
                return (
                  <tr key={room.roomId}>
                    <td style={tdStyle}>
                      <code>{room.roomId}</code>
                    </td>
                    <td style={tdStyle}>{room.peerCount}</td>
                    <td style={tdStyle}>
                      <Badge tone={connLabel.tone}>{connLabel.text}</Badge>
                    </td>
                    <td style={tdStyle}>
                      {room.activeTransfers.length === 0
                        ? '—'
                        : room.activeTransfers
                            .map((t) => {
                              const arrow = t.direction === 'send' ? '↑' : '↓';
                              const queued =
                                t.direction === 'send' && t.queueTotal && t.queueTotal > 1
                                  ? ` (queued ${t.queueIndex}/${t.queueTotal})`
                                  : '';
                              const paused = t.direction === 'send' && t.userPaused ? ' ⏸ PAUSED' : '';
                              return `${arrow} ${t.fileName}${queued}${paused} (${formatBytes(t.bytesTransferred)} / ${formatBytes(t.fileSize)})`;
                            })
                            .join(', ')}
                    </td>
                    <td style={tdStyle}>
                      {backpressured.length === 0 ? (
                        room.activeTransfers.some((t) => typeof t.writeLagBytes === 'number') ? (
                          <Badge tone="success">OK</Badge>
                        ) : (
                          '—'
                        )
                      ) : (
                        <Badge tone="accent">
                          ⏸ disk lag {formatBytes(Math.max(...backpressured.map((t) => t.writeLagBytes ?? 0)))}
                        </Badge>
                      )}
                    </td>
                    <td style={tdStyle}>{formatDuration(now - new Date(room.firstSeenAt).getTime())}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Active chat rooms</h2>
      <Card padded={false}>
        {snapshot.chatRooms.length === 0 ? (
          <p style={{ padding: 16, fontSize: 13, color: theme.color.textSecondary }}>No active rooms.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ROOM ID</th>
                <th style={thStyle}>NAME</th>
                <th style={thStyle}></th>
                <th style={thStyle}>PARTICIPANTS</th>
                <th style={thStyle}>MESSAGES</th>
                <th style={thStyle}>EXPIRES IN</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.chatRooms.map((room) => (
                <tr key={room.roomId}>
                  <td style={tdStyle}>
                    <code>{room.roomId}</code>
                  </td>
                  <td style={tdStyle}>{room.roomName}</td>
                  <td style={tdStyle}>
                    {room.isPrivate ? <Badge tone="accent">PRIVATE</Badge> : <Badge tone="success">PUBLIC</Badge>}
                  </td>
                  <td style={tdStyle}>{room.participantCount}</td>
                  <td style={tdStyle}>{room.messageCount}</td>
                  <td style={tdStyle}>{formatDuration(new Date(room.expiresAt).getTime() - now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Active live streams</h2>
      <Card padded={false}>
        {snapshot.streamRooms.length === 0 ? (
          <p style={{ padding: 16, fontSize: 13, color: theme.color.textSecondary }}>No active streams.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ROOM ID</th>
                <th style={thStyle}>TITLE</th>
                <th style={thStyle}></th>
                <th style={thStyle}>VIEWERS</th>
                <th style={thStyle}>CONNECTIONS (DIRECT / RELAY / UNKNOWN)</th>
                <th style={thStyle}>CAPTIONS</th>
                <th style={thStyle}>CHAT MSGS</th>
                <th style={thStyle}>JOINS (LINK / CODE / DISCOVERY)</th>
                <th style={thStyle}>SIGNALING BYTES VS. DURATION</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.streamRooms.map((room) => (
                <tr key={room.roomId}>
                  <td style={tdStyle}>
                    <code>{room.roomId}</code>
                  </td>
                  <td style={tdStyle}>{room.title}</td>
                  <td style={tdStyle}>
                    {room.isPrivate ? <Badge tone="accent">PRIVATE</Badge> : <Badge tone="success">PUBLIC</Badge>}
                  </td>
                  <td style={tdStyle}>{room.viewerCount}</td>
                  <td style={tdStyle}>
                    {room.connectionBreakdown.direct} direct / {room.connectionBreakdown.relay} relay /{' '}
                    {room.connectionBreakdown.unknown} unknown
                  </td>
                  <td style={tdStyle}>{room.captionCount}</td>
                  <td style={tdStyle}>{room.chatMessageCount}</td>
                  <td style={tdStyle}>
                    {room.joinCounts.link} / {room.joinCounts.code} / {room.joinCounts.discovery}
                  </td>
                  <td style={tdStyle}>
                    {formatBytes(room.signalingBytesTracked)} over{' '}
                    {formatDuration(now - new Date(room.firstSeenAt).getTime())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
