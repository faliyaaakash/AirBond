//store inforamation of iceConfig ( STUN & TURN URLS)

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        import.meta.env.VITE_STUN_URL || 'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
    // Coturn relay fallback (used when direct P2P NAT traversal fails)
    ...(import.meta.env.VITE_TURN_URL
      ? [
          {
            urls: import.meta.env.VITE_TURN_URL,
            username: import.meta.env.VITE_TURN_USERNAME,
            credential: import.meta.env.VITE_TURN_CREDENTIAL,
          },
        ]
      : []),
  ],
  iceCandidatePoolSize: 10,
};