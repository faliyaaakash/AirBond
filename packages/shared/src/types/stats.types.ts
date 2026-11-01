// Everything here is aggregate/metadata only - room IDs, counts, sizes, timing.
// Never file content, never chat message text.

export type ConnectionType = 'direct' | 'relay' | 'unknown';

export interface ActiveFileTransferStat {
  direction: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  // Present only for a 'receive' entry once that peer has ever reported a
  // backpressure ping (disk write lagging the incoming data rate). Absent
  // means "never reported" (e.g. OPFS unsupported on that browser), not
  // necessarily "zero lag".
  writeLagBytes?: number;
  backpressureEngaged?: boolean;
  // Present only for a 'send' entry - which file in the broadcastFiles()
  // queue this is, and whether the user has paused sending.
  queueIndex?: number;
  queueTotal?: number;
  userPaused?: boolean;
}

export interface FileRoomStat {
  roomId: string;
  peerCount: number;
  activeTransfers: ActiveFileTransferStat[];
  firstSeenAt: string; // ISO
  connectionType: ConnectionType;
}

export interface ChatRoomStat {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  participantCount: number;
  messageCount: number;
  expiresAt: string; // ISO
}

// Per-viewer WebRTC connection classification, aggregated at snapshot time -
// the same "direct vs relay" proof already used for file transfers, applied
// per stream so the dashboard can show how many viewers actually got a P2P
// connection vs needed a TURN relay.
export interface StreamConnectionBreakdown {
  direct: number;
  relay: number;
  unknown: number;
}

// How viewers of a given stream arrived - discovery list, join-by-code, or a
// shared deep link (?streamid=&passkey=) - to show whether link-sharing
// actually drives joins.
export interface StreamJoinCounts {
  discovery: number;
  code: number;
  link: number;
}

export interface StreamRoomStat {
  roomId: string;
  title: string;
  isPrivate: boolean;
  viewerCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: 'camera' | 'screen';
  captionCount: number;
  chatMessageCount: number;
  // What actually crossed the wire to this server for this stream (SDP/ICE/
  // caption/chat/reaction relay) - contrasted against firstSeenAt on the
  // dashboard to show it stays tiny no matter how long the stream runs, since
  // the video/audio itself never touches the server.
  signalingBytesTracked: number;
  connectionBreakdown: StreamConnectionBreakdown;
  joinCounts: StreamJoinCounts;
  firstSeenAt: string; // ISO
}

export interface TrafficPoint {
  bucketStart: string; // ISO
  fileBytes: number;
  chatMessages: number;
}

export interface StatsTotals {
  activeFileRooms: number;
  activeChatRooms: number;
  connectedFilePeers: number;
  connectedChatPeers: number;
  totalFileBytesTracked: number;
  totalChatMessagesTracked: number;
  // The proof metric: how many bytes actually crossed the wire to this server
  // (SDP/ICE negotiation + tiny progress/message pings) versus how many bytes
  // of file content moved directly between peers, reported by the clients.
  totalSignalingBytesTracked: number;
  activeStreamRooms: number;
  connectedStreamViewers: number;
  totalCaptionsTracked: number;
  totalStreamChatMessagesTracked: number;
  // Headline proof metric for deep-link sharing: how many stream joins came
  // in via a `?streamid=&passkey=` link vs. discovery/code.
  totalStreamLinkJoinsTracked: number;
}

// A single entry in the live "wire log" - literally what the server received,
// with its real payload size, never the payload content itself.
export interface StatsEventLogEntry {
  id: string;
  timestamp: string; // ISO
  event: string;
  sizeBytes: number;
  roomId?: string;
}

export interface StatsSnapshot {
  generatedAt: string; // ISO
  totals: StatsTotals;
  fileRooms: FileRoomStat[];
  chatRooms: ChatRoomStat[];
  streamRooms: StreamRoomStat[];
  traffic: TrafficPoint[];
  recentEvents: StatsEventLogEntry[];
}

export interface StatsAuthPayload {
  code: string;
}
