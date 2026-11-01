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
import {
  CALL_EVENTS,
  CallCreatedPayload,
  CallEndedPayload,
  CallJoinedPayload,
  CallJoinErrorPayload,
  CallPeerJoinedPayload,
  CallTrackStatePayload,
} from '@airbond/shared';
import { CallRoomService, CallRoomState } from './call-room.service';
import { JoinCallDto } from './dto/join-call.dto';
import { RoomIdDto } from './dto/room-id.dto';
import { TrackStateDto } from './dto/track-state.dto';
import { validateDto } from '../../common/validate-dto';

// Private, 2-person video calling. No discovery list (join by room ID/link
// only), no chat sidebar, no captions - just room lifecycle for exactly two
// anonymous participants plus the WebRTC signaling relay between them.
@WebSocketGateway({
  namespace: '/call',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);

  constructor(private readonly callRoomService: CallRoomService) {}

  handleConnection() {
    // No lobby/auto-join - calls are private, nothing to push on connect.
  }

  handleDisconnect(client: Socket) {
    const room = this.callRoomService.findRoomBySocket(client.id);
    if (!room) return;
    this.closeRoom(room, client.id);
  }

  @SubscribeMessage(CALL_EVENTS.CREATE_CALL)
  handleCreateCall(@ConnectedSocket() client: Socket) {
    const room = this.callRoomService.createRoom(client.id, (expiredRoomId) =>
      this.onRoomExpired(expiredRoomId),
    );
    void client.join(room.roomId);
    client.emit(CALL_EVENTS.CALL_CREATED, {
      roomId: room.roomId,
    } satisfies CallCreatedPayload);
    this.logger.log(`Call created: ${room.roomId} by ${client.id}`);
  }

  @SubscribeMessage(CALL_EVENTS.JOIN_CALL)
  async handleJoinCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value, errors } = await validateDto(JoinCallDto, data);
    if (!value) {
      return this.emitJoinError(client, 'INVALID_INPUT', errors.join(' '));
    }

    const result = this.callRoomService.joinRoom(value.roomId, client.id);
    if (result === 'NOT_FOUND') {
      return this.emitJoinError(
        client,
        'CALL_NOT_FOUND',
        'This call does not exist or has ended.',
      );
    }
    if (result === 'FULL') {
      return this.emitJoinError(
        client,
        'CALL_FULL',
        'This call already has two people in it.',
      );
    }

    const room = result;
    await client.join(room.roomId);

    client.emit(CALL_EVENTS.CALL_JOINED, {
      roomId: room.roomId,
      peerId: room.hostSocketId,
      micEnabled: room.micEnabled,
      cameraEnabled: room.cameraEnabled,
    } satisfies CallJoinedPayload);

    this.server.to(room.hostSocketId).emit(CALL_EVENTS.PEER_JOINED, {
      peerId: client.id,
    } satisfies CallPeerJoinedPayload);

    this.logger.log(`${client.id} joined call ${room.roomId}`);
  }

  @SubscribeMessage(CALL_EVENTS.SDP_OFFER)
  handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; sdp: RTCSessionDescriptionInit },
  ) {
    this.server.to(data.targetPeerId).emit(CALL_EVENTS.SDP_OFFER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(CALL_EVENTS.SDP_ANSWER)
  handleSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; sdp: RTCSessionDescriptionInit },
  ) {
    this.server.to(data.targetPeerId).emit(CALL_EVENTS.SDP_ANSWER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(CALL_EVENTS.ICE_CANDIDATE)
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; candidate: RTCIceCandidateInit },
  ) {
    this.server.to(data.targetPeerId).emit(CALL_EVENTS.ICE_CANDIDATE, {
      senderPeerId: client.id,
      candidate: data.candidate,
    });
  }

  @SubscribeMessage(CALL_EVENTS.TRACK_STATE)
  async handleTrackState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(TrackStateDto, data);
    if (!value) return;

    const room = this.callRoomService.findRoomBySocket(client.id);
    if (!room || room.roomId !== value.roomId) return;

    this.callRoomService.setTrackState(
      room,
      value.micEnabled,
      value.cameraEnabled,
    );

    const otherPeerId = this.callRoomService.otherPeerId(room, client.id);
    if (!otherPeerId) return;
    this.server.to(otherPeerId).emit(CALL_EVENTS.TRACK_STATE, {
      micEnabled: value.micEnabled,
      cameraEnabled: value.cameraEnabled,
    } satisfies CallTrackStatePayload);
  }

  @SubscribeMessage(CALL_EVENTS.LEAVE_CALL)
  async handleLeaveCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    const { value } = await validateDto(RoomIdDto, data);
    if (!value) return;

    const room = this.callRoomService.findRoomBySocket(client.id);
    if (!room || room.roomId !== value.roomId) return;
    this.closeRoom(room, client.id);
  }

  private onRoomExpired(roomId: string) {
    this.server.to(roomId).emit(CALL_EVENTS.CALL_ENDED, {
      reason: 'EXPIRED',
    } satisfies CallEndedPayload);
    void this.server.in(roomId).socketsLeave(roomId);
    this.logger.log(`Call ${roomId} force-closed (expired)`);
  }

  // A call is exactly two people - whichever one leaves or disconnects, the
  // room closes for both rather than waiting around for a replacement.
  private closeRoom(room: CallRoomState, leavingSocketId: string) {
    const otherPeerId = this.callRoomService.otherPeerId(room, leavingSocketId);
    if (otherPeerId) {
      this.server.to(otherPeerId).emit(CALL_EVENTS.CALL_ENDED, {
        reason: 'PEER_LEFT',
      } satisfies CallEndedPayload);
    }
    void this.server.in(room.roomId).socketsLeave(room.roomId);
    this.callRoomService.removeRoom(room.roomId);
    this.logger.log(`Call ${room.roomId} closed (${leavingSocketId} left)`);
  }

  private emitJoinError(
    client: Socket,
    code: CallJoinErrorPayload['code'],
    message: string,
  ) {
    client.emit(CALL_EVENTS.JOIN_ERROR, {
      code,
      message,
    } satisfies CallJoinErrorPayload);
  }
}
