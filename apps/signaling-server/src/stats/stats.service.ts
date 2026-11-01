import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ActiveFileTransferStat,
  ChatRoomStat,
  ConnectionType,
  FileRoomStat,
  StatsEventLogEntry,
  StatsSnapshot,
  StreamConnectionBreakdown,
  StreamJoinCounts,
  StreamJoinSource,
  StreamRoomStat,
  TrafficPoint,
  VideoSource,
} from '@airbond/shared';
import { RedisService } from '../common/redis/redis.service';

const BUCKET_SECONDS = 5;
const BUCKET_TTL_SECONDS = 900; // 15 minutes of rolling traffic history, then it just expires
const TRAFFIC_WINDOW_BUCKETS = 60; // 60 * 5s = 5 minutes shown on the live chart
const EVENT_LOG_CAPACITY = 40;

interface FileRoomEntry {
  roomId: string;
  peerCount: number;
  firstSeenAt: Date;
  connectionType: ConnectionType;
  // keyed by `${socketId}:${direction}` so one peer can have an active send and
  // an active receive tracked independently
  transfers: Map<
    string,
    ActiveFileTransferStat & { lastBytesTransferred: number }
  >;
}

interface ChatRoomEntry {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  participantCount: number;
  messageCount: number;
  expiresAt: Date;
}

interface StreamRoomEntry {
  roomId: string;
  title: string;
  isPrivate: boolean;
  viewerCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
  captionCount: number;
  chatMessageCount: number;
  // What actually crossed the wire to this server for this stream (SDP/ICE/
  // caption/chat/reaction relay) - the per-stream half of the proof metric,
  // contrasted against firstSeenAt on the dashboard.
  signalingBytes: number;
  // Per-viewer socketId -> classification, aggregated into a direct/relay/
  // unknown breakdown at snapshot time.
  viewerConnections: Map<string, ConnectionType>;
  joinCounts: StreamJoinCounts;
  firstSeenAt: Date;
}

// Every value tracked here is aggregate/metadata: room IDs, peer counts, byte
// counts, message counts, filenames+sizes. Never file content, never chat text.
// The time-series lives in Redis with a 15-minute TTL per bucket - a rolling
// window for the live dashboard graph, not a permanent record.
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  private readonly fileRooms = new Map<string, FileRoomEntry>();
  private readonly chatRooms = new Map<string, ChatRoomEntry>();
  private readonly streamRooms = new Map<string, StreamRoomEntry>();
  // Newest-first ring buffer: literally what this server received, with its
  // real payload size, never the payload content.
  private readonly recentEvents: StatsEventLogEntry[] = [];

  constructor(private readonly redisService: RedisService) {}

  // --- The proof log: what actually crossed the wire to this server --------

  async recordSignalingMessage(
    event: string,
    sizeBytes: number,
    roomId?: string,
  ) {
    this.recentEvents.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event,
      sizeBytes,
      roomId,
    });
    if (this.recentEvents.length > EVENT_LOG_CAPACITY) {
      this.recentEvents.length = EVENT_LOG_CAPACITY;
    }
    await this.redisService.client.incrby(
      'stats:total:signalingBytes',
      sizeBytes,
    );
  }

  // --- File-sharing rooms -----------------------------------------------

  setFileRoomPeerCount(roomId: string, peerCount: number) {
    if (peerCount <= 0) {
      this.fileRooms.delete(roomId);
      return;
    }
    const existing = this.fileRooms.get(roomId);
    if (existing) {
      existing.peerCount = peerCount;
      return;
    }
    this.fileRooms.set(roomId, {
      roomId,
      peerCount,
      firstSeenAt: new Date(),
      connectionType: 'unknown',
      transfers: new Map(),
    });
  }

  setFileRoomConnectionType(roomId: string, connectionType: ConnectionType) {
    const room = this.fileRooms.get(roomId);
    if (!room) return;
    // "relay" is the more newsworthy/definitive result once observed - don't
    // let a later "unknown" from a different peer overwrite it.
    if (room.connectionType === 'relay' && connectionType !== 'relay') return;
    room.connectionType = connectionType;
  }

  async recordFileTransferProgress(
    roomId: string,
    socketId: string,
    direction: 'send' | 'receive',
    fileName: string,
    fileSize: number,
    bytesTransferred: number,
    queueIndex?: number,
    queueTotal?: number,
    userPaused?: boolean,
  ) {
    const room = this.fileRooms.get(roomId);
    if (!room) return;

    const key = `${socketId}:${direction}`;
    const previous = room.transfers.get(key);
    const previousBytes = previous?.lastBytesTransferred ?? 0;
    const delta = Math.max(0, bytesTransferred - previousBytes);

    room.transfers.set(key, {
      direction,
      fileName,
      fileSize,
      bytesTransferred,
      lastBytesTransferred: bytesTransferred,
      // A progress ping doesn't carry backpressure info - keep whatever this
      // transfer last reported instead of wiping it out every ~150ms.
      writeLagBytes: previous?.writeLagBytes,
      backpressureEngaged: previous?.backpressureEngaged,
      queueIndex: queueIndex ?? previous?.queueIndex,
      queueTotal: queueTotal ?? previous?.queueTotal,
      userPaused: userPaused ?? previous?.userPaused,
    });

    if (bytesTransferred >= fileSize) {
      // Transfer finished - stop listing it as "active" shortly after, but keep
      // the delta accounting above so the final chunk still counts toward traffic.
      setTimeout(() => {
        const current = room.transfers.get(key);
        if (current?.bytesTransferred === bytesTransferred) {
          room.transfers.delete(key);
        }
      }, 3000).unref();
    }

    if (delta > 0) {
      await this.addToBucket(delta, 0);
      await this.redisService.client.incrby('stats:total:fileBytes', delta);
    }
  }

  // A receiver's OPFS disk write has fallen behind (or caught back up with)
  // the incoming data rate. Purely a UI annotation on the existing transfer
  // entry - never affects the byte-delta/traffic accounting above.
  recordFileTransferBackpressure(
    roomId: string,
    socketId: string,
    fileName: string,
    writeLagBytes: number,
    engaged: boolean,
  ) {
    const room = this.fileRooms.get(roomId);
    if (!room) return;

    const key = `${socketId}:receive`;
    const existing = room.transfers.get(key);
    if (!existing) return;

    existing.writeLagBytes = writeLagBytes;
    existing.backpressureEngaged = engaged;
    // fileName is already known from the progress ping, but keep it aligned
    // in case a backpressure ping ever outraces the first progress ping.
    existing.fileName = fileName;
  }

  // --- Chat rooms ----------------------------------------------------------

  upsertChatRoom(
    roomId: string,
    roomName: string,
    isPrivate: boolean,
    participantCount: number,
    expiresAt: Date,
  ) {
    if (participantCount <= 0) {
      this.chatRooms.delete(roomId);
      return;
    }
    const existing = this.chatRooms.get(roomId);
    if (existing) {
      existing.participantCount = participantCount;
      return;
    }
    this.chatRooms.set(roomId, {
      roomId,
      roomName,
      isPrivate,
      participantCount,
      messageCount: 0,
      expiresAt,
    });
  }

  removeChatRoom(roomId: string) {
    this.chatRooms.delete(roomId);
  }

  // For leave/disconnect, where the caller only knows the new count, not the
  // room's other metadata. No-op if the room isn't tracked (nothing to update).
  setChatRoomParticipantCount(roomId: string, participantCount: number) {
    if (participantCount <= 0) {
      this.chatRooms.delete(roomId);
      return;
    }
    const existing = this.chatRooms.get(roomId);
    if (existing) existing.participantCount = participantCount;
  }

  async recordChatMessage(roomId: string) {
    const room = this.chatRooms.get(roomId);
    if (room) room.messageCount += 1;

    await this.addToBucket(0, 1);
    await this.redisService.client.incr('stats:total:chatMessages');
  }

  // --- Live streams ----------------------------------------------------------

  upsertStreamRoom(
    roomId: string,
    title: string,
    isPrivate: boolean,
    viewerCount: number,
  ) {
    const existing = this.streamRooms.get(roomId);
    if (existing) {
      existing.viewerCount = viewerCount;
      return;
    }
    this.streamRooms.set(roomId, {
      roomId,
      title,
      isPrivate,
      viewerCount,
      micEnabled: true,
      cameraEnabled: true,
      videoSource: 'camera',
      captionCount: 0,
      chatMessageCount: 0,
      signalingBytes: 0,
      viewerConnections: new Map(),
      joinCounts: { discovery: 0, code: 0, link: 0 },
      firstSeenAt: new Date(),
    });
  }

  setStreamViewerCount(roomId: string, viewerCount: number) {
    const room = this.streamRooms.get(roomId);
    if (room) room.viewerCount = viewerCount;
  }

  setStreamTrackState(
    roomId: string,
    micEnabled: boolean,
    cameraEnabled: boolean,
    videoSource: VideoSource,
  ) {
    const room = this.streamRooms.get(roomId);
    if (!room) return;
    room.micEnabled = micEnabled;
    room.cameraEnabled = cameraEnabled;
    room.videoSource = videoSource;
  }

  setStreamViewerConnectionType(
    roomId: string,
    socketId: string,
    connectionType: ConnectionType,
  ) {
    const room = this.streamRooms.get(roomId);
    if (!room) return;
    room.viewerConnections.set(socketId, connectionType);
  }

  // Tallies how a viewer arrived (discovery list, join-by-code, or a shared
  // deep link) so the dashboard can show whether link-sharing actually
  // drives joins. Only "link" gets a global counter, mirroring the other
  // headline "total...Tracked" proof metrics.
  async recordStreamJoin(roomId: string, source: StreamJoinSource) {
    const room = this.streamRooms.get(roomId);
    if (room) room.joinCounts[source] += 1;
    if (source === 'link') {
      await this.redisService.client.incr('stats:total:streamLinkJoins');
    }
  }

  addStreamSignalingBytes(roomId: string, sizeBytes: number) {
    const room = this.streamRooms.get(roomId);
    if (room) room.signalingBytes += sizeBytes;
  }

  async recordStreamCaption(roomId: string) {
    const room = this.streamRooms.get(roomId);
    if (room) room.captionCount += 1;
    await this.redisService.client.incr('stats:total:streamCaptions');
  }

  async recordStreamChatMessage(roomId: string) {
    const room = this.streamRooms.get(roomId);
    if (room) room.chatMessageCount += 1;
    await this.redisService.client.incr('stats:total:streamChatMessages');
  }

  removeStreamRoom(roomId: string) {
    this.streamRooms.delete(roomId);
  }

  // --- Snapshot for the dashboard ------------------------------------------

  async getSnapshot(): Promise<StatsSnapshot> {
    const [
      traffic,
      totalFileBytes,
      totalChatMessages,
      totalSignalingBytes,
      totalStreamCaptions,
      totalStreamChatMessages,
      totalStreamLinkJoins,
    ] = await Promise.all([
      this.getTrafficSeries(),
      this.redisService.client.get('stats:total:fileBytes'),
      this.redisService.client.get('stats:total:chatMessages'),
      this.redisService.client.get('stats:total:signalingBytes'),
      this.redisService.client.get('stats:total:streamCaptions'),
      this.redisService.client.get('stats:total:streamChatMessages'),
      this.redisService.client.get('stats:total:streamLinkJoins'),
    ]);

    const fileRooms: FileRoomStat[] = [...this.fileRooms.values()].map(
      (room) => ({
        roomId: room.roomId,
        peerCount: room.peerCount,
        activeTransfers: [...room.transfers.values()].map(
          ({
            direction,
            fileName,
            fileSize,
            bytesTransferred,
            writeLagBytes,
            backpressureEngaged,
            queueIndex,
            queueTotal,
            userPaused,
          }) => ({
            direction,
            fileName,
            fileSize,
            bytesTransferred,
            writeLagBytes,
            backpressureEngaged,
            queueIndex,
            queueTotal,
            userPaused,
          }),
        ),
        firstSeenAt: room.firstSeenAt.toISOString(),
        connectionType: room.connectionType,
      }),
    );

    const chatRooms: ChatRoomStat[] = [...this.chatRooms.values()].map(
      (room) => ({
        roomId: room.roomId,
        roomName: room.roomName,
        isPrivate: room.isPrivate,
        participantCount: room.participantCount,
        messageCount: room.messageCount,
        expiresAt: room.expiresAt.toISOString(),
      }),
    );

    const streamRooms: StreamRoomStat[] = [...this.streamRooms.values()].map(
      (room) => ({
        roomId: room.roomId,
        title: room.title,
        isPrivate: room.isPrivate,
        viewerCount: room.viewerCount,
        micEnabled: room.micEnabled,
        cameraEnabled: room.cameraEnabled,
        videoSource: room.videoSource,
        captionCount: room.captionCount,
        chatMessageCount: room.chatMessageCount,
        signalingBytesTracked: room.signalingBytes,
        connectionBreakdown: this.connectionBreakdown(room.viewerConnections),
        joinCounts: { ...room.joinCounts },
        firstSeenAt: room.firstSeenAt.toISOString(),
      }),
    );

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        activeFileRooms: fileRooms.length,
        activeChatRooms: chatRooms.length,
        connectedFilePeers: fileRooms.reduce((sum, r) => sum + r.peerCount, 0),
        connectedChatPeers: chatRooms.reduce(
          (sum, r) => sum + r.participantCount,
          0,
        ),
        totalFileBytesTracked: Number(totalFileBytes ?? 0),
        totalChatMessagesTracked: Number(totalChatMessages ?? 0),
        totalSignalingBytesTracked: Number(totalSignalingBytes ?? 0),
        activeStreamRooms: streamRooms.length,
        connectedStreamViewers: streamRooms.reduce(
          (sum, r) => sum + r.viewerCount,
          0,
        ),
        totalCaptionsTracked: Number(totalStreamCaptions ?? 0),
        totalStreamChatMessagesTracked: Number(totalStreamChatMessages ?? 0),
        totalStreamLinkJoinsTracked: Number(totalStreamLinkJoins ?? 0),
      },
      fileRooms,
      chatRooms,
      streamRooms,
      traffic,
      recentEvents: this.recentEvents,
    };
  }

  private connectionBreakdown(
    connections: Map<string, ConnectionType>,
  ): StreamConnectionBreakdown {
    const breakdown: StreamConnectionBreakdown = {
      direct: 0,
      relay: 0,
      unknown: 0,
    };
    for (const connectionType of connections.values()) {
      breakdown[connectionType] += 1;
    }
    return breakdown;
  }

  private bucketKey(epochSeconds: number): string {
    const bucketStart =
      Math.floor(epochSeconds / BUCKET_SECONDS) * BUCKET_SECONDS;
    return `stats:bucket:${bucketStart}`;
  }

  private async addToBucket(fileBytes: number, chatMessages: number) {
    const key = this.bucketKey(Math.floor(Date.now() / 1000));
    const pipeline = this.redisService.client.pipeline();
    if (fileBytes > 0) pipeline.hincrby(key, 'fileBytes', fileBytes);
    if (chatMessages > 0) pipeline.hincrby(key, 'chatMessages', chatMessages);
    pipeline.expire(key, BUCKET_TTL_SECONDS);
    try {
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `Failed to write traffic bucket: ${(err as Error).message}`,
      );
    }
  }

  private async getTrafficSeries(): Promise<TrafficPoint[]> {
    const nowBucket =
      Math.floor(Date.now() / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;
    const bucketEpochs: number[] = [];
    for (let i = TRAFFIC_WINDOW_BUCKETS - 1; i >= 0; i--) {
      bucketEpochs.push(nowBucket - i * BUCKET_SECONDS);
    }

    const pipeline = this.redisService.client.pipeline();
    bucketEpochs.forEach((epoch) => pipeline.hgetall(`stats:bucket:${epoch}`));

    let results: [Error | null, unknown][] = [];
    try {
      results = (await pipeline.exec()) ?? [];
    } catch (err) {
      this.logger.warn(
        `Failed to read traffic buckets: ${(err as Error).message}`,
      );
    }

    return bucketEpochs.map((epoch, i) => {
      const data = (results[i]?.[1] ?? {}) as Record<string, string>;
      return {
        bucketStart: new Date(epoch * 1000).toISOString(),
        fileBytes: Number(data.fileBytes ?? 0),
        chatMessages: Number(data.chatMessages ?? 0),
      };
    });
  }
}
