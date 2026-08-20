import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { ChatRoomSummary } from '@airbond/shared';
import { ChatRoom, ChatRoomDocument } from './chat-room.schema';
import { CHAT_ROOM_TTL_SECONDS } from './chat.constants';

const SALT_ROUNDS = 10;
const ROOM_ID_GENERATION_ATTEMPTS = 5;

@Injectable()
export class ChatRoomService {
  private readonly logger = new Logger(ChatRoomService.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
  ) {}

  async createRoom(
    roomName: string,
    isPrivate: boolean,
    password: string | undefined,
    onExpire: (roomId: string) => void,
  ): Promise<ChatRoomDocument> {
    const roomId = await this.generateUniqueRoomId();
    const passwordHash =
      isPrivate && password
        ? await bcrypt.hash(password, SALT_ROUNDS)
        : undefined;

    const room = await this.chatRoomModel.create({
      roomId,
      roomName: roomName.trim(),
      isPrivate,
      passwordHash,
      createdAt: new Date(),
    });

    this.scheduleExpiry(room, onExpire);
    this.logger.log(
      `Chat room created: ${roomId} ("${room.roomName}", private=${isPrivate})`,
    );
    return room;
  }

  async findRoom(roomId: string): Promise<ChatRoomDocument | null> {
    return this.chatRoomModel.findOne({ roomId }).exec();
  }

  isExpired(room: ChatRoomDocument): boolean {
    return Date.now() - room.createdAt.getTime() > CHAT_ROOM_TTL_SECONDS * 1000;
  }

  async verifyPassword(
    room: ChatRoomDocument,
    password: string | undefined,
  ): Promise<boolean> {
    if (!room.isPrivate) return true;
    if (!password || !room.passwordHash) return false;
    return bcrypt.compare(password, room.passwordHash);
  }

  toSummary(room: ChatRoomDocument, participantCount: number): ChatRoomSummary {
    return {
      roomId: room.roomId,
      roomName: room.roomName,
      isPrivate: room.isPrivate,
      participantCount,
      expiresAt: new Date(
        room.createdAt.getTime() + CHAT_ROOM_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  // Schedules the in-process force-close for a room. Idempotent per roomId so a
  // room already tracked (e.g. re-fetched on a later join) doesn't get double-armed.
  scheduleExpiry(room: ChatRoomDocument, onExpire: (roomId: string) => void) {
    if (this.expiryTimers.has(room.roomId)) return;

    const remainingMs =
      CHAT_ROOM_TTL_SECONDS * 1000 - (Date.now() - room.createdAt.getTime());
    const fire = async () => {
      this.expiryTimers.delete(room.roomId);
      await this.chatRoomModel.deleteOne({ roomId: room.roomId }).exec();
      onExpire(room.roomId);
    };

    if (remainingMs <= 0) {
      void fire();
      return;
    }
    this.expiryTimers.set(
      room.roomId,
      // unref so this purely-internal bookkeeping timer never keeps the process
      // (or a test run) alive on its own.
      setTimeout(() => void fire(), remainingMs).unref(),
    );
  }

  private async generateUniqueRoomId(): Promise<string> {
    for (let attempt = 0; attempt < ROOM_ID_GENERATION_ATTEMPTS; attempt++) {
      const candidate = randomUUID().slice(0, 8);
      const exists = await this.chatRoomModel.exists({ roomId: candidate });
      if (!exists) return candidate;
    }
    throw new Error('Failed to generate a unique chat room ID');
  }
}
