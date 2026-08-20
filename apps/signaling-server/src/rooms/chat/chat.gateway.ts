import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CHAT_EVENTS,
  ChatErrorPayload,
  ChatJoinErrorPayload,
  ChatJoinSuccessPayload,
  ChatMessagePayload,
  ChatMessageReactedPayload,
  ChatParticipant,
  ChatRoomClosedPayload,
  ChatUserJoinedPayload,
  ChatUserLeftPayload,
  ChatUserTypingPayload,
} from '@airbond/shared';
import { ChatRoomService } from './chat-room.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { RoomIdDto } from './dto/room-id.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { validateDto } from './validate-dto';

const MESSAGE_MAX_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MS = 5000;
const RATE_LIMIT_MAX_MESSAGES = 10;

interface RateLimitState {
  windowStart: number;
  count: number;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class ChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // roomId -> socketId -> stageName
  private readonly participants = new Map<string, Map<string, string>>();
  private readonly rateLimits = new Map<string, RateLimitState>();

  constructor(private readonly chatRoomService: ChatRoomService) {}

  handleDisconnect(client: Socket) {
    this.rateLimits.delete(client.id);
    for (const roomId of this.participants.keys()) {
      if (this.participants.get(roomId)?.has(client.id)) {
        this.removeParticipant(roomId, client);
      }
    }
  }

  @SubscribeMessage(CHAT_EVENTS.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(JoinRoomDto, data);
    if (!value) {
      return this.emitJoinError(client, 'INVALID_INPUT', errors.join(' '));
    }

    const roomId = value.roomId.trim();
    const stageName = value.stageName.trim();
    if (!roomId || !stageName) {
      return this.emitJoinError(
        client,
        'INVALID_INPUT',
        'Room ID and stage name are required.',
      );
    }

    const room = await this.chatRoomService.findRoom(roomId);
    if (!room) {
      return this.emitJoinError(
        client,
        'ROOM_NOT_FOUND',
        'This chat room does not exist.',
      );
    }
    if (this.chatRoomService.isExpired(room)) {
      return this.emitJoinError(
        client,
        'ROOM_EXPIRED',
        'This chat room has expired.',
      );
    }
    const passwordOk = await this.chatRoomService.verifyPassword(
      room,
      value.password,
    );
    if (!passwordOk) {
      return this.emitJoinError(
        client,
        'INVALID_PASSWORD',
        'Incorrect room password.',
      );
    }

    const members = this.participants.get(roomId) ?? new Map<string, string>();
    const nameTaken = [...members.values()].some(
      (existing) => existing.toLowerCase() === stageName.toLowerCase(),
    );
    if (nameTaken) {
      return this.emitJoinError(
        client,
        'NAME_TAKEN',
        'That stage name is already taken in this room.',
      );
    }

    // Ensures this process has an expiry timer armed for the room, covering rooms
    // looked up fresh from Mongo (e.g. after a server restart).
    this.chatRoomService.scheduleExpiry(room, (expiredRoomId) =>
      this.forceCloseRoom(expiredRoomId),
    );

    members.set(client.id, stageName);
    this.participants.set(roomId, members);
    await client.join(roomId);

    const successPayload: ChatJoinSuccessPayload = {
      ...this.chatRoomService.toSummary(room, members.size),
      participants: this.listParticipants(roomId),
    };
    client.emit(CHAT_EVENTS.JOIN_SUCCESS, successPayload);

    const joinedPayload: ChatUserJoinedPayload = {
      stageName,
      participantCount: members.size,
    };
    client.to(roomId).emit(CHAT_EVENTS.USER_JOINED, joinedPayload);

    this.logger.log(
      `"${stageName}" joined chat room ${roomId} (${members.size} participants)`,
    );
  }

  @SubscribeMessage(CHAT_EVENTS.LEAVE_ROOM)
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(RoomIdDto, data);
    if (!value) return;
    this.removeParticipant(value.roomId, client);
  }

  @SubscribeMessage(CHAT_EVENTS.SEND_MESSAGE)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(SendMessageDto, data);
    if (!value) {
      return this.emitChatError(client, 'INVALID_INPUT', errors.join(' '));
    }

    const roomId = value.roomId;
    const stageName = this.participants.get(roomId)?.get(client.id);
    if (!stageName) return;

    const text = value.text.trim();
    if (!text) {
      return this.emitChatError(
        client,
        'MESSAGE_EMPTY',
        'Message cannot be empty.',
      );
    }
    if (text.length > MESSAGE_MAX_LENGTH) {
      return this.emitChatError(
        client,
        'MESSAGE_TOO_LONG',
        `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`,
      );
    }
    if (!this.checkRateLimit(client.id)) {
      return this.emitChatError(
        client,
        'RATE_LIMITED',
        'You are sending messages too fast.',
      );
    }

    const message: ChatMessagePayload = {
      messageId: randomUUID(),
      stageName,
      text,
      sentAt: new Date().toISOString(),
      replyTo: value.replyTo,
    };
    this.server.to(roomId).emit(CHAT_EVENTS.NEW_MESSAGE, message);
  }

  @SubscribeMessage(CHAT_EVENTS.REACT_MESSAGE)
  async handleReactMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(ReactMessageDto, data);
    if (!value) return;

    const roomId = value.roomId;
    const stageName = this.participants.get(roomId)?.get(client.id);
    if (!stageName) return;
    if (!this.checkRateLimit(client.id)) return;

    const payload: ChatMessageReactedPayload = {
      messageId: value.messageId,
      stageName,
      reacted: value.reacted,
    };
    this.server.to(roomId).emit(CHAT_EVENTS.MESSAGE_REACTED, payload);
  }

  @SubscribeMessage(CHAT_EVENTS.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(RoomIdDto, data);
    if (!value) return;
    this.broadcastTyping(value.roomId, client, true);
  }

  @SubscribeMessage(CHAT_EVENTS.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(RoomIdDto, data);
    if (!value) return;
    this.broadcastTyping(value.roomId, client, false);
  }

  getParticipantCount(roomId: string): number {
    return this.participants.get(roomId)?.size ?? 0;
  }

  // Called by ChatRoomService once a room's TTL elapses.
  forceCloseRoom(roomId: string) {
    const payload: ChatRoomClosedPayload = { reason: 'EXPIRED' };
    this.server.to(roomId).emit(CHAT_EVENTS.ROOM_CLOSED, payload);
    this.server.in(roomId).socketsLeave(roomId);
    this.participants.delete(roomId);
    this.logger.log(`Chat room ${roomId} force-closed (expired)`);
  }

  private removeParticipant(roomId: string, client: Socket) {
    const members = this.participants.get(roomId);
    const stageName = members?.get(client.id);
    if (!members || !stageName) return;

    members.delete(client.id);
    void client.leave(roomId);
    if (members.size === 0) {
      this.participants.delete(roomId);
    }

    const leftPayload: ChatUserLeftPayload = {
      stageName,
      participantCount: members.size,
    };
    client.to(roomId).emit(CHAT_EVENTS.USER_LEFT, leftPayload);
  }

  private listParticipants(roomId: string): ChatParticipant[] {
    const members = this.participants.get(roomId);
    if (!members) return [];
    return [...members.entries()].map(([socketId, stageName]) => ({
      socketId,
      stageName,
    }));
  }

  private broadcastTyping(roomId: string, client: Socket, isTyping: boolean) {
    const stageName = this.participants.get(roomId)?.get(client.id);
    if (!stageName) return;
    const payload: ChatUserTypingPayload = { stageName, isTyping };
    client.to(roomId).emit(CHAT_EVENTS.USER_TYPING, payload);
  }

  private checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    const state = this.rateLimits.get(socketId);
    if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(socketId, { windowStart: now, count: 1 });
      return true;
    }
    state.count += 1;
    return state.count <= RATE_LIMIT_MAX_MESSAGES;
  }

  private emitJoinError(
    client: Socket,
    reason: ChatJoinErrorPayload['reason'],
    message: string,
  ) {
    const payload: ChatJoinErrorPayload = { reason, message };
    client.emit(CHAT_EVENTS.JOIN_ERROR, payload);
  }

  private emitChatError(
    client: Socket,
    code: ChatErrorPayload['code'],
    message: string,
  ) {
    const payload: ChatErrorPayload = { code, message };
    client.emit(CHAT_EVENTS.CHAT_ERROR, payload);
  }
}
