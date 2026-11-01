import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { StreamSummary, VideoSource } from '@airbond/shared';
import { STREAM_ROOM_TTL_SECONDS } from './stream.constants';

const SALT_ROUNDS = 10;
const ROOM_ID_GENERATION_ATTEMPTS = 5;

export interface StreamRoomState {
  roomId: string;
  title: string;
  isPrivate: boolean;
  passwordHash?: string;
  broadcasterSocketId: string;
  // socketId -> viewer info
  viewers: Map<string, { displayName: string }>;
  micEnabled: boolean;
  cameraEnabled: boolean;
  videoSource: VideoSource;
  createdAt: Date;
}

// In-memory analog of ChatRoomService - streams don't need Mongo persistence
// (no name/password history to keep across restarts), just the same room
// lifecycle shape: create/find/verifyPassword/toSummary/scheduleExpiry.
@Injectable()
export class StreamRoomService {
  private readonly logger = new Logger(StreamRoomService.name);
  private readonly rooms = new Map<string, StreamRoomState>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  // Reverse indexes so disconnect handling doesn't need to scan every room.
  private readonly broadcasterIndex = new Map<string, string>(); // socketId -> roomId
  private readonly viewerIndex = new Map<string, string>(); // socketId -> roomId

  async createRoom(
    title: string,
    isPrivate: boolean,
    password: string | undefined,
    broadcasterSocketId: string,
    onExpire: (roomId: string) => void,
  ): Promise<StreamRoomState> {
    const roomId = this.generateUniqueRoomId();
    const passwordHash =
      isPrivate && password
        ? await bcrypt.hash(password, SALT_ROUNDS)
        : undefined;

    const room: StreamRoomState = {
      roomId,
      title: title.trim(),
      isPrivate,
      passwordHash,
      broadcasterSocketId,
      viewers: new Map(),
      micEnabled: true,
      cameraEnabled: true,
      videoSource: 'camera',
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.broadcasterIndex.set(broadcasterSocketId, roomId);
    this.scheduleExpiry(room, onExpire);
    this.logger.log(
      `Stream created: ${roomId} ("${room.title}", private=${isPrivate})`,
    );
    return room;
  }

  findRoom(roomId: string): StreamRoomState | undefined {
    return this.rooms.get(roomId);
  }

  findRoomByBroadcaster(socketId: string): StreamRoomState | undefined {
    const roomId = this.broadcasterIndex.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  async verifyPassword(
    room: StreamRoomState,
    password: string | undefined,
  ): Promise<boolean> {
    if (!room.isPrivate) return true;
    if (!password || !room.passwordHash) return false;
    return bcrypt.compare(password, room.passwordHash);
  }

  addViewer(
    roomId: string,
    socketId: string,
    displayName: string,
  ): StreamRoomState | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    room.viewers.set(socketId, { displayName });
    this.viewerIndex.set(socketId, roomId);
    return room;
  }

  // Returns the room a viewer was removed from, or undefined if this socket
  // wasn't a tracked viewer of any room.
  removeViewer(socketId: string): StreamRoomState | undefined {
    const roomId = this.viewerIndex.get(socketId);
    if (!roomId) return undefined;
    const room = this.rooms.get(roomId);
    room?.viewers.delete(socketId);
    this.viewerIndex.delete(socketId);
    return room;
  }

  setTrackState(
    room: StreamRoomState,
    micEnabled: boolean,
    cameraEnabled: boolean,
    videoSource: VideoSource,
  ) {
    room.micEnabled = micEnabled;
    room.cameraEnabled = cameraEnabled;
    room.videoSource = videoSource;
  }

  toSummary(room: StreamRoomState): StreamSummary {
    return {
      roomId: room.roomId,
      title: room.title,
      isPrivate: room.isPrivate,
      viewerCount: room.viewers.size,
      createdAt: room.createdAt.toISOString(),
    };
  }

  listSummaries(): StreamSummary[] {
    return [...this.rooms.values()].map((room) => this.toSummary(room));
  }

  // Idempotent per roomId, same unref'd-timer pattern as ChatRoomService, so
  // this purely-internal bookkeeping timer never keeps the process alive.
  scheduleExpiry(room: StreamRoomState, onExpire: (roomId: string) => void) {
    if (this.expiryTimers.has(room.roomId)) return;

    const remainingMs =
      STREAM_ROOM_TTL_SECONDS * 1000 - (Date.now() - room.createdAt.getTime());
    const fire = () => {
      this.expiryTimers.delete(room.roomId);
      this.removeRoom(room.roomId);
      onExpire(room.roomId);
    };

    if (remainingMs <= 0) {
      fire();
      return;
    }
    this.expiryTimers.set(room.roomId, setTimeout(fire, remainingMs).unref());
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.broadcasterIndex.delete(room.broadcasterSocketId);
    for (const socketId of room.viewers.keys()) {
      this.viewerIndex.delete(socketId);
    }
    this.rooms.delete(roomId);

    const timer = this.expiryTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(roomId);
    }
  }

  private generateUniqueRoomId(): string {
    for (let attempt = 0; attempt < ROOM_ID_GENERATION_ATTEMPTS; attempt++) {
      const candidate = randomUUID().slice(0, 8);
      if (!this.rooms.has(candidate)) return candidate;
    }
    throw new Error('Failed to generate a unique stream room ID');
  }
}
