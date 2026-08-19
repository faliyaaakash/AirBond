import React, { useState } from 'react';
import { usePeerConnection } from './webrtc/usePeerConnection';

export default function FileRoom() {
  const {
    roomId,
    connectedPeers,
    isSocketConnected,
    createRoom,
    joinRoom,
    broadcastFile,
    receivedBytes,
  } = usePeerConnection();

  const [joinInput, setJoinInput] = useState('');
  const [status, setStatus] = useState('Idle');

  const handleSend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus(`Broadcasting ${file.name} to ${connectedPeers.length} peers...`);
      await broadcastFile(file);
      setStatus(`Sent ${file.name} successfully!`);
    } catch (err: any) {
      setStatus(`Failed: ${err.message}`);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 20, fontFamily: 'sans-serif' }}>
      <h2>AirBond Multi-Peer Mesh (Redis-Backed)</h2>
      <p>Signaling: <strong style={{ color: isSocketConnected ? 'green' : 'red' }}>{isSocketConnected ? 'Connected' : 'Offline'}</strong></p>
      <p>Connected Mesh Peers: <strong>{connectedPeers.length}</strong> {connectedPeers.length > 0 && `(${connectedPeers.join(', ')})`}</p>

      <div>
        <button onClick={createRoom}>1. Create Room</button>
        {roomId && <span style={{ marginLeft: 10 }}>Room ID: <strong>{roomId}</strong></span>}
      </div>

      <div style={{ marginTop: 12 }}>
        <input placeholder="Room ID" value={joinInput} onChange={(e) => setJoinInput(e.target.value)} />
        <button onClick={() => joinRoom(joinInput)} style={{ marginLeft: 8 }}>2. Join Room</button>
      </div>

      <hr style={{ margin: '20px 0' }} />

      <div>
        <h3>Broadcast File to All Peers</h3>
        <input type="file" onChange={handleSend} disabled={connectedPeers.length === 0} />
        <p>Status: <strong>{status}</strong></p>
      </div>

      <div style={{ marginTop: 16, background: '#f4f4f4', padding: 12 }}>
        <h4>Incoming Progress</h4>
        <p>Total Bytes Received: <strong>{receivedBytes}</strong> bytes</p>
      </div>
    </div>
  );
}