import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CALL_ROOM_TTL_SECONDS } from './call.constants';

const ROOM_ID_GENERATION_ATTEMPTS = 5;

export interface CallRoomState {
  roomId: string;
  hostSocketId: string;
  guestSocketId?: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  createdAt: Date;
}

// In-memory only, no persistence - a call is exactly two anonymous
// participants for the life of one connection, same "no storage" shape as
// StreamRoomService but simpler still (no viewer list, no password, no
// discovery list to keep live).
@Injectable()
export class CallRoomService {
  private readonly logger = new Logger(CallRoomService.name);
  private readonly rooms = new Map<string, CallRoomState>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  // socketId -> roomId, for either participant - disconnect handling doesn't
  // need to know in advance whether a socket was the host or the guest.
  private readonly socketIndex = new Map<string, string>();

  createRoom(
    hostSocketId: string,
    onExpire: (roomId: string) => void,
  ): CallRoomState {
    const roomId = this.generateUniqueRoomId();
    const room: CallRoomState = {
      roomId,
      hostSocketId,
      micEnabled: true,
      cameraEnabled: true,
      createdAt: new Date(),
    };
    this.rooms.set(roomId, room);
    this.socketIndex.set(hostSocketId, roomId);
    this.scheduleExpiry(room, onExpire);
    this.logger.log(`Call created: ${roomId} by ${hostSocketId}`);
    return room;
  }

  findRoom(roomId: string): CallRoomState | undefined {
    return this.rooms.get(roomId);
  }

  findRoomBySocket(socketId: string): CallRoomState | undefined {
    const roomId = this.socketIndex.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  // Returns the room on success, or 'FULL'/'NOT_FOUND' so the gateway can
  // emit the right JOIN_ERROR code without a second lookup.
  joinRoom(
    roomId: string,
    guestSocketId: string,
  ): CallRoomState | 'FULL' | 'NOT_FOUND' {
    const room = this.rooms.get(roomId);
    if (!room) return 'NOT_FOUND';
    if (room.guestSocketId && room.guestSocketId !== guestSocketId)
      return 'FULL';

    room.guestSocketId = guestSocketId;
    this.socketIndex.set(guestSocketId, roomId);
    return room;
  }

  setTrackState(
    room: CallRoomState,
    micEnabled: boolean,
    cameraEnabled: boolean,
  ) {
    room.micEnabled = micEnabled;
    room.cameraEnabled = cameraEnabled;
  }

  // The other participant's socket id, if any - whoever isn't `socketId`.
  otherPeerId(room: CallRoomState, socketId: string): string | undefined {
    if (room.hostSocketId === socketId) return room.guestSocketId;
    if (room.guestSocketId === socketId) return room.hostSocketId;
    return undefined;
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.socketIndex.delete(room.hostSocketId);
    if (room.guestSocketId) this.socketIndex.delete(room.guestSocketId);
    this.rooms.delete(roomId);

    const timer = this.expiryTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(roomId);
    }
  }

  // Idempotent per roomId, same unref'd-timer pattern as every other room
  // service, so this purely-internal bookkeeping timer never keeps the
  // process alive.
  private scheduleExpiry(
    room: CallRoomState,
    onExpire: (roomId: string) => void,
  ) {
    if (this.expiryTimers.has(room.roomId)) return;

    const remainingMs =
      CALL_ROOM_TTL_SECONDS * 1000 - (Date.now() - room.createdAt.getTime());
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

  private generateUniqueRoomId(): string {
    for (let attempt = 0; attempt < ROOM_ID_GENERATION_ATTEMPTS; attempt++) {
      const candidate = randomUUID().slice(0, 8);
      if (!this.rooms.has(candidate)) return candidate;
    }
    throw new Error('Failed to generate a unique call room ID');
  }
}
