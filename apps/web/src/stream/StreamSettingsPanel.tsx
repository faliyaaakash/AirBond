import { useEffect, useState } from 'react';
import { theme } from '../theme';
import { useStreamSessionContext } from './StreamSessionContext';

interface StreamSettingsPanelProps {
  role: 'broadcaster' | 'viewer';
  captionsSupported: boolean;
  captionsVisible: boolean;
  onToggleCaptions: () => void;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: theme.color.textSecondary,
  marginBottom: 6,
};

const selectStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  fontSize: 13,
  fontFamily: theme.font.body,
  boxSizing: 'border-box',
};

// Broadcaster: live camera/mic device switching (no restart needed) plus
// captions toggle. Viewer: playback volume plus captions toggle - there is
// no other client-side "quality" to configure since the stream is a single
// WebRTC track, not an adaptive-bitrate ladder.
export default function StreamSettingsPanel({
  role,
  captionsSupported,
  captionsVisible,
  onToggleCaptions,
}: StreamSettingsPanelProps) {
  const { switchCamera, switchMicrophone, volume, setVolume, mediaError, unmute } = useStreamSessionContext();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (role !== 'broadcaster' || !navigator.mediaDevices?.enumerateDevices) return;

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
        setMicrophones(devices.filter((d) => d.kind === 'audioinput'));
      } catch {
        // Enumeration failed (unsupported browser, etc.) - selects below just
        // render no options.
      }
    };

    void loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, [role]);

  const showCaptionsToggle = role === 'viewer' || captionsSupported;

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {role === 'broadcaster' && (
        <>
          {cameras.length > 0 && (
            <div>
              <label style={labelStyle} htmlFor="stage-camera-select">
                CAMERA
              </label>
              <select
                id="stage-camera-select"
                style={selectStyle}
                defaultValue=""
                onChange={(e) => e.target.value && void switchCamera(e.target.value)}
              >
                <option value="" disabled>
                  Choose a camera…
                </option>
                {cameras.map((cam, i) => (
                  <option key={cam.deviceId || i} value={cam.deviceId}>
                    {cam.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {microphones.length > 0 && (
            <div>
              <label style={labelStyle} htmlFor="stage-mic-select">
                MICROPHONE
              </label>
              <select
                id="stage-mic-select"
                style={selectStyle}
                defaultValue=""
                onChange={(e) => e.target.value && void switchMicrophone(e.target.value)}
              >
                <option value="" disabled>
                  Choose a microphone…
                </option>
                {microphones.map((mic, i) => (
                  <option key={mic.deviceId || i} value={mic.deviceId}>
                    {mic.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {cameras.length === 0 && microphones.length === 0 && (
            <p style={{ fontSize: 12, color: theme.color.textSecondary, margin: 0 }}>No alternate devices found.</p>
          )}
        </>
      )}

      {role === 'viewer' && (
        <div>
          <label style={labelStyle} htmlFor="stage-volume">
            VOLUME
          </label>
          <input
            id="stage-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              unmute();
            }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {showCaptionsToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={captionsVisible} onChange={onToggleCaptions} />
          Show live captions
        </label>
      )}

      {mediaError && role === 'broadcaster' && (
        <p style={{ color: theme.color.danger, fontSize: 12, margin: 0 }}>{mediaError.message}</p>
      )}
    </div>
  );
}
