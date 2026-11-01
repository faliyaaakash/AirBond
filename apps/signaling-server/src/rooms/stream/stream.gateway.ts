import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CaptionPayload,
  ConnectionInfoPayload,
  NewReactionPayload,
  NewStreamMessagePayload,
  STREAM_EVENTS,
  StreamCreatedPayload,
  StreamEndedPayload,
  StreamJoinErrorPayload,
  StreamJoinedPayload,
  StreamKickedPayload,
  TrackStatePayload,
  ViewerCountPayload,
  ViewerJoinedPayload,
  ViewerLeftPayload,
} from '@airbond/shared';
import { StreamRoomService, StreamRoomState } from './stream-room.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { JoinStreamDto } from './dto/join-stream.dto';
import { RoomIdDto } from './dto/room-id.dto';
import { CaptionDto } from './dto/caption.dto';
import { TrackStateDto } from './dto/track-state.dto';
import { StreamMessageDto } from './dto/stream-message.dto';
import { ReactionDto } from './dto/reaction.dto';
import { KickViewerDto } from './dto/kick-viewer.dto';
import { validateDto } from '../../common/validate-dto';
import { StatsService } from '../../stats/stats.service';

// Every client connected to "/stream" auto-joins this room so the live
// discovery list can be pushed on change instead of polled.
const LOBBY_ROOM = '__lobby__';

const RATE_LIMIT_WINDOW_MS = 5000;
// Higher than chat's 10/5s - interim caption results are naturally more
// frequent than chat messages.
const RATE_LIMIT_MAX_EVENTS = 25;

interface RateLimitState {
  windowStart: number;
  count: number;
}

@WebSocketGateway({
  namespace: '/stream',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class StreamGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(StreamGateway.name);
  private readonly rateLimits = new Map<string, RateLimitState>();

  constructor(
    private readonly streamRoomService: StreamRoomService,
    private readonly statsService: StatsService,
  ) {}

  handleConnection(client: Socket) {
    void client.join(LOBBY_ROOM);
    client.emit(
      STREAM_EVENTS.STREAM_LIST,
      this.streamRoomService.listSummaries(),
    );
  }

  handleDisconnect(client: Socket) {
    this.rateLimits.delete(client.id);

    const asBroadcaster = this.streamRoomService.findRoomByBroadcaster(
      client.id,
    );
    if (asBroadcaster) {
      this.closeRoom(asBroadcaster, 'BROADCASTER_LEFT');
      return;
    }

    const room = this.streamRoomService.removeViewer(client.id);
    if (room) {
      this.statsService.setStreamViewerCount(room.roomId, room.viewers.size);
      this.server.to(room.broadcasterSocketId).emit(STREAM_EVENTS.VIEWER_LEFT, {
        viewerPeerId: client.id,
      } satisfies ViewerLeftPayload);
      this.server.to(room.roomId).emit(STREAM_EVENTS.VIEWER_COUNT, {
        count: room.viewers.size,
      } satisfies ViewerCountPayload);
      this.broadcastStreamList();
    }
  }

  @SubscribeMessage(STREAM_EVENTS.CREATE_STREAM)
  async handleCreateStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(CreateStreamDto, data);
    if (!value) {
      return this.emitStreamError(client, 'INVALID_INPUT', errors.join(' '));
    }

    const room = await this.streamRoomService.createRoom(
      value.title,
      value.isPrivate,
      value.password,
      client.id,
      (expiredRoomId) => this.onRoomExpired(expiredRoomId),
    );
    await client.join(room.roomId);
    this.statsService.upsertStreamRoom(
      room.roomId,
      room.title,
      room.isPrivate,
      0,
    );
    client.emit(STREAM_EVENTS.STREAM_CREATED, {
      roomId: room.roomId,
    } satisfies StreamCreatedPayload);
    this.broadcastStreamList();
    this.logger.log(`Stream created: ${room.roomId} by ${client.id}`);
  }

  @SubscribeMessage(STREAM_EVENTS.JOIN_STREAM)
  async handleJoinStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(JoinStreamDto, data);
    if (!value) {
      return this.emitJoinError(client, 'INVALID_INPUT', errors.join(' '));
    }

    const room = this.streamRoomService.findRoom(value.roomId);
    if (!room) {
      return this.emitJoinError(
        client,
        'STREAM_NOT_FOUND',
        'This stream is not live or has ended.',
      );
    }

    const passwordOk = await this.streamRoomService.verifyPassword(
      room,
      value.password,
    );
    if (!passwordOk) {
      return this.emitJoinError(
        client,
        'INVALID_PASSWORD',
        'Incorrect stream password.',
      );
    }

    await client.join(room.roomId);
    this.streamRoomService.addViewer(
      room.roomId,
      client.id,
      value.displayName.trim(),
    );
    this.statsService.setStreamViewerCount(room.roomId, room.viewers.size);
    void this.statsService.recordStreamJoin(
      room.roomId,
      value.joinSource ?? 'code',
    );

    client.emit(STREAM_EVENTS.STREAM_JOINED, {
      roomId: room.roomId,
      broadcasterPeerId: room.broadcasterSocketId,
      viewerCount: room.viewers.size,
      micEnabled: room.micEnabled,
      cameraEnabled: room.cameraEnabled,
      videoSource: room.videoSource,
    } satisfies StreamJoinedPayload);

    this.server.to(room.broadcasterSocketId).emit(STREAM_EVENTS.VIEWER_JOINED, {
      viewerPeerId: client.id,
      displayName: value.displayName.trim(),
    } satisfies ViewerJoinedPayload);

    this.server.to(room.roomId).emit(STREAM_EVENTS.VIEWER_COUNT, {
      count: room.viewers.size,
    } satisfies ViewerCountPayload);

    this.broadcastStreamList();
    this.logger.log(`${client.id} joined stream ${room.roomId}`);
  }

  @SubscribeMessage(STREAM_EVENTS.SDP_OFFER)
  handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetPeerId: string;
      sdp: RTCSessionDescriptionInit;
      roomId?: string;
    },
  ) {
    void this.logSignaling(STREAM_EVENTS.SDP_OFFER, data, data?.roomId);
    this.server.to(data.targetPeerId).emit(STREAM_EVENTS.SDP_OFFER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(STREAM_EVENTS.SDP_ANSWER)
  handleSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetPeerId: string;
      sdp: RTCSessionDescriptionInit;
      roomId?: string;
    },
  ) {
    void this.logSignaling(STREAM_EVENTS.SDP_ANSWER, data, data?.roomId);
    this.server.to(data.targetPeerId).emit(STREAM_EVENTS.SDP_ANSWER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(STREAM_EVENTS.ICE_CANDIDATE)
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetPeerId: string;
      candidate: RTCIceCandidateInit;
      roomId?: string;
    },
  ) {
    void this.logSignaling(STREAM_EVENTS.ICE_CANDIDATE, data, data?.roomId);
    this.server.to(data.targetPeerId).emit(STREAM_EVENTS.ICE_CANDIDATE, {
      senderPeerId: client.id,
      candidate: data.candidate,
    });
  }

  // Viewer-reported classification of its own peer connection (direct P2P vs
  // TURN relay) - the server has no visibility into this on its own.
  @SubscribeMessage(STREAM_EVENTS.CONNECTION_INFO)
  handleConnectionInfo(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ConnectionInfoPayload,
  ) {
    void this.logSignaling(STREAM_EVENTS.CONNECTION_INFO, data, data?.roomId);
    const roomId = (data.roomId || '').trim();
    if (!roomId) return;
    this.statsService.setStreamViewerConnectionType(
      roomId,
      client.id,
      data.connectionType,
    );
  }

  @SubscribeMessage(STREAM_EVENTS.CAPTION)
  async handleCaption(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(CaptionDto, data);
    if (!value) return;
    if (!this.checkRateLimit(client.id)) return;

    const room = this.streamRoomService.findRoomByBroadcaster(client.id);
    if (!room || room.roomId !== value.roomId) return;

    const text = value.text.trim();
    if (!text) return;

    const payload: CaptionPayload = {
      text,
      isFinal: value.isFinal,
      timestamp: Date.now(),
    };
    client.to(room.roomId).emit(STREAM_EVENTS.CAPTION, payload);
    void this.logSignaling(STREAM_EVENTS.CAPTION, value, room.roomId);
    if (value.isFinal) {
      void this.statsService.recordStreamCaption(room.roomId);
    }
  }

  @SubscribeMessage(STREAM_EVENTS.TRACK_STATE)
  async handleTrackState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(TrackStateDto, data);
    if (!value) return;

    const room = this.streamRoomService.findRoomByBroadcaster(client.id);
    if (!room || room.roomId !== value.roomId) return;

    this.streamRoomService.setTrackState(
      room,
      value.micEnabled,
      value.cameraEnabled,
      value.videoSource,
    );
    this.statsService.setStreamTrackState(
      room.roomId,
      value.micEnabled,
      value.cameraEnabled,
      value.videoSource,
    );

    const payload: TrackStatePayload = {
      micEnabled: value.micEnabled,
      cameraEnabled: value.cameraEnabled,
      videoSource: value.videoSource,
    };
    this.server.to(room.roomId).emit(STREAM_EVENTS.TRACK_STATE, payload);
    void this.logSignaling(STREAM_EVENTS.TRACK_STATE, value, room.roomId);
  }

  @SubscribeMessage(STREAM_EVENTS.SEND_STREAM_MESSAGE)
  async handleSendStreamMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(StreamMessageDto, data);
    if (!value) {
      return this.emitStreamError(client, 'INVALID_INPUT', errors.join(' '));
    }
    if (!this.checkRateLimit(client.id)) {
      return this.emitStreamError(
        client,
        'RATE_LIMITED',
        'You are sending messages too fast.',
      );
    }

    const room = this.streamRoomService.findRoom(value.roomId);
    if (!room) return;
    const isMember =
      room.broadcasterSocketId === client.id || room.viewers.has(client.id);
    if (!isMember) return;

    const text = value.text.trim();
    if (!text) return;

    const payload: NewStreamMessagePayload = {
      messageId: randomUUID(),
      displayName: value.displayName.trim(),
      text,
      sentAt: new Date().toISOString(),
    };
    this.server.to(room.roomId).emit(STREAM_EVENTS.NEW_STREAM_MESSAGE, payload);
    void this.logSignaling(
      STREAM_EVENTS.SEND_STREAM_MESSAGE,
      value,
      room.roomId,
    );
    void this.statsService.recordStreamChatMessage(room.roomId);
  }

  @SubscribeMessage(STREAM_EVENTS.SEND_REACTION)
  async handleSendReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(ReactionDto, data);
    if (!value) return;
    if (!this.checkRateLimit(client.id)) return;

    const room = this.streamRoomService.findRoom(value.roomId);
    if (!room) return;
    const isBroadcaster = room.broadcasterSocketId === client.id;
    const viewer = room.viewers.get(client.id);
    if (!isBroadcaster && !viewer) return;

    const payload: NewReactionPayload = {
      displayName: isBroadcaster ? room.title : viewer!.displayName,
      timestamp: Date.now(),
    };
    this.server.to(room.roomId).emit(STREAM_EVENTS.NEW_REACTION, payload);
    void this.logSignaling(STREAM_EVENTS.SEND_REACTION, value, room.roomId);
  }

  @SubscribeMessage(STREAM_EVENTS.KICK_VIEWER)
  async handleKickViewer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(KickViewerDto, data);
    if (!value) return;

    const room = this.streamRoomService.findRoomByBroadcaster(client.id);
    if (!room || room.roomId !== value.roomId) return;
    if (!room.viewers.has(value.viewerPeerId)) return;

    this.server.to(value.viewerPeerId).emit(STREAM_EVENTS.STREAM_KICKED, {
      reason: 'Removed by the broadcaster.',
    } satisfies StreamKickedPayload);
    void this.server.in(value.viewerPeerId).socketsLeave(room.roomId);
    this.streamRoomService.removeViewer(value.viewerPeerId);
    this.statsService.setStreamViewerCount(room.roomId, room.viewers.size);

    this.server.to(room.roomId).emit(STREAM_EVENTS.VIEWER_COUNT, {
      count: room.viewers.size,
    } satisfies ViewerCountPayload);
    this.broadcastStreamList();
  }

  @SubscribeMessage(STREAM_EVENTS.END_STREAM)
  async handleEndStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(RoomIdDto, data);
    if (!value) return;

    const room = this.streamRoomService.findRoomByBroadcaster(client.id);
    if (!room || room.roomId !== value.roomId) return;
    this.closeRoom(room, 'ENDED_BY_BROADCASTER');
  }

  private onRoomExpired(roomId: string) {
    this.server.to(roomId).emit(STREAM_EVENTS.STREAM_ENDED, {
      reason: 'EXPIRED',
    } satisfies StreamEndedPayload);
    void this.server.in(roomId).socketsLeave(roomId);
    this.statsService.removeStreamRoom(roomId);
    this.broadcastStreamList();
    this.logger.log(`Stream ${roomId} force-closed (expired)`);
  }

  private closeRoom(
    room: StreamRoomState,
    reason: 'ENDED_BY_BROADCASTER' | 'BROADCASTER_LEFT',
  ) {
    this.server.to(room.roomId).emit(STREAM_EVENTS.STREAM_ENDED, {
      reason,
    } satisfies StreamEndedPayload);
    void this.server.in(room.roomId).socketsLeave(room.roomId);
    this.streamRoomService.removeRoom(room.roomId);
    this.statsService.removeStreamRoom(room.roomId);
    this.broadcastStreamList();
    this.logger.log(`Stream ${room.roomId} closed (${reason})`);
  }

  private broadcastStreamList() {
    this.server
      .to(LOBBY_ROOM)
      .emit(STREAM_EVENTS.STREAM_LIST, this.streamRoomService.listSummaries());
  }

  // Measures the real size of what this server received, both for the global
  // wire-proof log (shared with every other gateway) and, when a roomId is
  // known, per-stream - so the dashboard can contrast tiny signaling bytes
  // against how long the stream has been running.
  private async logSignaling(event: string, data: unknown, roomId?: string) {
    const sizeBytes = Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
    await this.statsService.recordSignalingMessage(event, sizeBytes, roomId);
    if (roomId) {
      this.statsService.addStreamSignalingBytes(roomId, sizeBytes);
    }
  }

  private checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    const state = this.rateLimits.get(socketId);
    if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(socketId, { windowStart: now, count: 1 });
      return true;
    }
    state.count += 1;
    return state.count <= RATE_LIMIT_MAX_EVENTS;
  }

  private emitJoinError(
    client: Socket,
    code: StreamJoinErrorPayload['code'],
    message: string,
  ) {
    client.emit(STREAM_EVENTS.JOIN_ERROR, {
      code,
      message,
    } satisfies StreamJoinErrorPayload);
  }

  private emitStreamError(
    client: Socket,
    code: 'RATE_LIMITED' | 'INVALID_INPUT' | 'NOT_BROADCASTER',
    message: string,
  ) {
    client.emit(STREAM_EVENTS.STREAM_ERROR, { code, message });
  }
}
