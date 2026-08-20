import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePeerConnection } from './usePeerConnection';
import { formatBytes, formatSpeed } from './formatBytes';
import { theme } from '../theme';
import Badge from '../components/Badge';
import Card from '../components/Card';
import Button from '../components/Button';
import ProgressBar from '../components/ProgressBar';
import CopyButton from '../components/CopyButton';

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  fontSize: 14,
  fontFamily: theme.font.body,
};

export default function FileSharePage() {
  const { roomId: roomIdFromUrl } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    roomId,
    connectedPeers,
    isSocketConnected,
    createRoom,
    joinRoom,
    broadcastFile,
    receivedBytes,
    receiveFileMeta,
    receiveSpeedBps,
    sendFileMeta,
    sendProgress,
    sendSpeedBps,
  } = usePeerConnection();

  const [joinInput, setJoinInput] = useState(roomIdFromUrl ?? '');
  const [status, setStatus] = useState('');
  const autoJoinAttempted = useRef(false);

  // Visiting /files/room/:roomId directly (e.g. a shared link) auto-joins that room
  // once the signaling socket is up, instead of requiring a manual "Join Room" click.
  useEffect(() => {
    if (!roomIdFromUrl || autoJoinAttempted.current || !isSocketConnected) return;
    autoJoinAttempted.current = true;
    joinRoom(roomIdFromUrl);
  }, [roomIdFromUrl, isSocketConnected, joinRoom]);

  // Once a room is created or joined, reflect it in the URL so it's shareable/bookmarkable.
  useEffect(() => {
    if (roomId && roomId !== roomIdFromUrl) {
      navigate(`/files/room/${roomId}`, { replace: true });
    }
  }, [roomId, roomIdFromUrl, navigate]);

  const handleSend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus('');
      await broadcastFile(file);
      setStatus(`Sent ${file.name} successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Failed: ${message}`);
    }
  };

  const receiveProgress =
    receiveFileMeta && receiveFileMeta.size > 0 ? Math.min(1, receivedBytes / receiveFileMeta.size) : 0;
  const receiveComplete = !!receiveFileMeta && receiveProgress >= 1;
  const sendComplete = !!sendFileMeta && sendProgress >= 1;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 40px', fontFamily: theme.font.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 30 }}>File Share</h1>
        <Badge tone={isSocketConnected ? 'success' : 'neutral'} dot>
          {isSocketConnected ? 'Signaling connected' : 'Signaling offline'}
        </Badge>
      </div>
      <p style={{ color: theme.color.textSecondary, fontSize: 14, marginTop: 6 }}>
        Create a room, share the ID, and drop files in — they stream directly to everyone
        connected over a peer-to-peer WebRTC data channel. Nothing passes through our server.
      </p>

      {!roomId ? (
        <div style={{ display: 'flex', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
          <Card style={{ flex: '1 1 260px' }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Create a room</h3>
            <Button onClick={createRoom} disabled={!isSocketConnected}>
              Create room
            </Button>
          </Card>
          <Card style={{ flex: '1 1 260px' }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Join a room</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="Room ID"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
              />
              <Button variant="secondary" onClick={() => joinRoom(joinInput)} disabled={!isSocketConnected}>
                Join
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <>
          <Card style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: theme.color.textSecondary }}>Room ID:</span>
                <code style={{ fontSize: 14 }}>{roomId}</code>
                <CopyButton value={roomId} label="Copy" />
              </div>
              <Button variant="secondary" onClick={() => navigate('/files')} style={{ padding: '8px 18px', fontSize: 13 }}>
                Leave
              </Button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              {connectedPeers.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: theme.color.accentSoft,
                    color: theme.color.accentHover,
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  P{i + 1}
                </span>
              ))}
              <span style={{ fontSize: 13, color: theme.color.textSecondary }}>
                {connectedPeers.length} peer{connectedPeers.length === 1 ? '' : 's'} connected
              </span>
            </div>
          </Card>

          <Card style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Send a file</h3>
            <input type="file" onChange={handleSend} disabled={connectedPeers.length === 0} />
            {connectedPeers.length === 0 && (
              <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
                Waiting for a peer to join before you can send.
              </p>
            )}
            {status && <p style={{ fontSize: 13, marginTop: 8 }}>{status}</p>}

            {sendFileMeta && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{sendFileMeta.name}</span>
                  <span style={{ color: theme.color.textSecondary }}>
                    {formatBytes(sendProgress * sendFileMeta.size)} / {formatBytes(sendFileMeta.size)}
                    {!sendComplete && ` · ${formatSpeed(sendSpeedBps)}`}
                    {sendComplete && ' · done'}
                  </span>
                </div>
                <ProgressBar fraction={sendProgress} />
              </div>
            )}
          </Card>

          <Card style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Incoming</h3>
            {!receiveFileMeta && (
              <p style={{ fontSize: 13, color: theme.color.textSecondary }}>No incoming transfer yet.</p>
            )}
            {receiveFileMeta && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{receiveFileMeta.name}</span>
                  <span style={{ color: theme.color.textSecondary }}>
                    {formatBytes(receivedBytes)} / {formatBytes(receiveFileMeta.size)}
                    {!receiveComplete && ` · ${formatSpeed(receiveSpeedBps)}`}
                    {receiveComplete && ' · downloaded'}
                  </span>
                </div>
                <ProgressBar fraction={receiveProgress} />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
