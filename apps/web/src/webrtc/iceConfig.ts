//store inforamation of iceConfig ( STUN & TURN URLS)

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        import.meta.env.VITE_STUN_URL || 'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
    // Coturn relay fallback (used when direct P2P NAT traversal fails) -
    // typically a LAN address (e.g. VITE_TURN_URL=turn:192.168.x.x:3478),
    // so it's only reachable from the same network as that server. Harmless
    // to include even when unreachable (that one candidate just fails to
    // gather) - RTCPeerConnection still uses whatever else works.
    ...(import.meta.env.VITE_TURN_URL
      ? [
          {
            urls: import.meta.env.VITE_TURN_URL,
            username: import.meta.env.VITE_TURN_USERNAME,
            credential: import.meta.env.VITE_TURN_CREDENTIAL,
          },
        ]
      : []),
    // Public TURN fallback (OpenRelay/Metered's free, open demo server) -
    // reachable from any network, unlike the LAN-only coturn above. This is
    // what actually saves a demo on an unfamiliar network (campus/corporate
    // WiFi with symmetric NAT or client isolation) where neither direct P2P
    // nor the LAN TURN server works. Public/shared credentials - fine for a
    // demo, not for anything that needs guaranteed capacity or privacy.
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};