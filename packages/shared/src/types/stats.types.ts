// Everything here is aggregate/metadata only - room IDs, counts, sizes, timing.
// Never file content, never chat message text.

export type ConnectionType = 'direct' | 'relay' | 'unknown';

export interface ActiveFileTransferStat {
  direction: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
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
  traffic: TrafficPoint[];
  recentEvents: StatsEventLogEntry[];
}

export interface StatsAuthPayload {
  code: string;
}
