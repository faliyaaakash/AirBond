import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ActiveFileTransferStat,
  ChatRoomStat,
  ConnectionType,
  FileRoomStat,
  StatsEventLogEntry,
  StatsSnapshot,
  TrafficPoint,
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

// Every value tracked here is aggregate/metadata: room IDs, peer counts, byte
// counts, message counts, filenames+sizes. Never file content, never chat text.
// The time-series lives in Redis with a 15-minute TTL per bucket - a rolling
// window for the live dashboard graph, not a permanent record.
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  private readonly fileRooms = new Map<string, FileRoomEntry>();
  private readonly chatRooms = new Map<string, ChatRoomEntry>();
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

  // --- Snapshot for the dashboard ------------------------------------------

  async getSnapshot(): Promise<StatsSnapshot> {
    const [traffic, totalFileBytes, totalChatMessages, totalSignalingBytes] =
      await Promise.all([
        this.getTrafficSeries(),
        this.redisService.client.get('stats:total:fileBytes'),
        this.redisService.client.get('stats:total:chatMessages'),
        this.redisService.client.get('stats:total:signalingBytes'),
      ]);

    const fileRooms: FileRoomStat[] = [...this.fileRooms.values()].map(
      (room) => ({
        roomId: room.roomId,
        peerCount: room.peerCount,
        activeTransfers: [...room.transfers.values()].map(
          ({ direction, fileName, fileSize, bytesTransferred }) => ({
            direction,
            fileName,
            fileSize,
            bytesTransferred,
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
      },
      fileRooms,
      chatRooms,
      traffic,
      recentEvents: this.recentEvents,
    };
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
