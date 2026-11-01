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
    broadcastFiles,
    receivedBytes,
    receiveFileMeta,
    receiveSpeedBps,
    sendFileMeta,
    sendProgress,
    sendSpeedBps,
    sendQueueTotal,
    sendQueueIndex,
    isSendPaused,
    isSendBackpressured,
    isReceivePaused,
    isReceiveDiskSlow,
    receiveWriteLagBytes,
    receiveError,
    pauseSend,
    resumeSend,
  } = usePeerConnection();

  const [joinInput, setJoinInput] = useState(roomIdFromUrl ?? '');
  const [status, setStatus] = useState('');
  const autoJoinAttempted = useRef(false);

  // Visiting /files/room/:roomId directly (e.g. a shared link) auto-joins that room
  // once the signaling socket is up, instead of requiring a manual "Join Room" click.
  // autoJoinAttempted is set unconditionally the first time this runs (not only
  // when it decides to actually join) - manually creating/joining a room updates
  // the URL to /files/room/:roomId via the effect below, which flips roomIdFromUrl
  // from undefined to a value on the SAME mount. Setting the flag up front makes
  // it a true "did this effect's decision ever run" latch instead of one only a
  // successful join trips, so that URL update can't cause a second join attempt.
  useEffect(() => {
    if (!roomIdFromUrl || autoJoinAttempted.current || !isSocketConnected) return;
    autoJoinAttempted.current = true;
    if (roomId) return; // already in a room from our own create/join, not a fresh deep link
    joinRoom(roomIdFromUrl);
  }, [roomIdFromUrl, isSocketConnected, joinRoom, roomId]);

  // Once a room is created or joined, reflect it in the URL so it's shareable/bookmarkable.
  useEffect(() => {
    if (roomId && roomId !== roomIdFromUrl) {
      navigate(`/files/room/${roomId}`, { replace: true });
    }
  }, [roomId, roomIdFromUrl, navigate]);

  const handleSend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    try {
      setStatus('');
      await broadcastFiles(files);
      setStatus(files.length === 1 ? `Sent ${files[0].name} successfully.` : `Sent ${files.length} files successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Failed: ${message}`);
    } finally {
      e.target.value = '';
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
            <input
              type="file"
              multiple
              onChange={handleSend}
              disabled={connectedPeers.length === 0 || sendQueueTotal > 0}
            />
            {connectedPeers.length === 0 && (
              <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
                Waiting for a peer to join before you can send.
              </p>
            )}
            {connectedPeers.length > 0 && sendQueueTotal > 0 && (
              <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
                Finish the current send before starting another.
              </p>
            )}
            {status && <p style={{ fontSize: 13, marginTop: 8 }}>{status}</p>}

            {sendFileMeta && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>
                    {sendFileMeta.name}
                    {sendQueueTotal > 1 && ` (file ${sendQueueIndex} of ${sendQueueTotal})`}
                  </span>
                  <span style={{ color: theme.color.textSecondary }}>
                    {formatBytes(sendProgress * sendFileMeta.size)} / {formatBytes(sendFileMeta.size)}
                    {!sendComplete && isSendPaused && ' · paused'}
                    {!sendComplete && !isSendPaused && isSendBackpressured && ' · waiting on receiver’s disk'}
                    {!sendComplete && !isSendPaused && !isSendBackpressured && ` · ${formatSpeed(sendSpeedBps)}`}
                    {sendComplete && ' · done'}
                  </span>
                </div>
                <ProgressBar fraction={sendProgress} />
                {!sendComplete && isSendBackpressured && !isSendPaused && (
                  <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
                    A receiver's storage can't keep up with the incoming data - sending will resume
                    automatically once it catches up.
                  </p>
                )}
                {!sendComplete && (
                  <Button
                    variant="secondary"
                    onClick={isSendPaused ? resumeSend : pauseSend}
                    style={{ marginTop: 8, padding: '6px 16px', fontSize: 13 }}
                  >
                    {isSendPaused ? 'Resume' : 'Pause'}
                  </Button>
                )}
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
                    {!receiveComplete && isReceivePaused && ' · paused by sender'}
                    {!receiveComplete && !isReceivePaused && ` · ${formatSpeed(receiveSpeedBps)}`}
                    {receiveComplete && ' · downloaded'}
                  </span>
                </div>
                <ProgressBar fraction={receiveProgress} />
                {!receiveComplete && isReceiveDiskSlow && (
                  <p style={{ fontSize: 12, color: theme.color.textSecondary, marginTop: 6 }}>
                    Your device's storage is falling behind ({formatBytes(receiveWriteLagBytes)} not yet written) -
                    we've asked the sender to slow down until it catches up.
                  </p>
                )}
              </div>
            )}
            {receiveError && (
              <p style={{ fontSize: 13, color: theme.color.danger, marginTop: receiveFileMeta ? 10 : 0 }}>
                {receiveError}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
