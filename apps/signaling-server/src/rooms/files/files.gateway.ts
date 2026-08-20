import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  ConnectionInfoPayload,
  FileTransferProgressPayload,
  SOCKET_EVENTS,
} from '@airbond/shared';
import { RedisService } from '../../common/redis/redis.service';
import { StatsService } from '../../stats/stats.service';
import { randomUUID } from 'crypto';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class FileGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly redisService: RedisService,
    private readonly statsService: StatsService,
  ) {}

  afterInit() {
    console.log(' FileGateway WebSocket Server active on port 4000');
  }

  handleConnection(client: Socket) {
    console.log(`[Socket Connected]: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`[Socket Disconnected]: ${client.id}`);
    const { roomId, remainingPeers } = await this.redisService.removePeer(
      client.id,
    );
    if (roomId) {
      this.server
        .to(roomId)
        .emit(SOCKET_EVENTS.LEAVE_ROOM, { peerId: client.id });
      this.statsService.setFileRoomPeerCount(roomId, remainingPeers.length);
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CREATE_ROOM)
  async handleCreateRoom(@ConnectedSocket() client: Socket) {
    const roomId = randomUUID().slice(0, 8);

    // Socket joins room
    await client.join(roomId);
    await this.redisService.addPeerToRoom(roomId, client.id); // Add Host socket ID to Redis room set
    this.statsService.setFileRoomPeerCount(roomId, 1);
    client.emit(SOCKET_EVENTS.ROOM_CREATED, { roomId }); // Emit room created to host
    console.log(`[Room Created]: ${roomId} by Host ${client.id}`);
  }

  @SubscribeMessage(SOCKET_EVENTS.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const cleanRoomId = (data.roomId || '').trim();
    if (!cleanRoomId) return;

    await client.join(cleanRoomId);

    // Add Joiner to Redis and get all OTHER existing peers (the Host)
    const existingPeers = await this.redisService.addPeerToRoom(
      cleanRoomId,
      client.id,
    );
    this.statsService.setFileRoomPeerCount(
      cleanRoomId,
      existingPeers.length + 1,
    );

    console.log(
      `Peer ${client.id} joined room ${cleanRoomId}. Existing peers found in Redis:`,
      existingPeers,
    );

    // Send the existing peers list to the new joiner
    client.emit('room-users', { peers: existingPeers });

    //Notify the host (and any other peers) that a new peer joined
    client
      .to(cleanRoomId)
      .emit(SOCKET_EVENTS.PEER_JOINED, { peerId: client.id });
  }

  // Lightweight metadata-only ping reported alongside a P2P transfer - the file
  // itself never passes through here, only filename/size/bytes-so-far for the
  // live stats dashboard.
  @SubscribeMessage(SOCKET_EVENTS.FILE_TRANSFER_PROGRESS)
  async handleFileTransferProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: FileTransferProgressPayload,
  ) {
    void this.logSignaling(
      SOCKET_EVENTS.FILE_TRANSFER_PROGRESS,
      data,
      data?.roomId,
    );

    const roomId = (data.roomId || '').trim();
    if (!roomId || !data.fileName || typeof data.fileSize !== 'number') return;

    await this.statsService.recordFileTransferProgress(
      roomId,
      client.id,
      data.direction,
      data.fileName,
      data.fileSize,
      data.bytesTransferred,
    );
  }

  // Reported once a peer connection settles - classifies whether it went
  // direct P2P or needed a TURN relay. Pure metadata (a string), never
  // anything about the connection's content.
  @SubscribeMessage(SOCKET_EVENTS.CONNECTION_INFO)
  handleConnectionInfo(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ConnectionInfoPayload,
  ) {
    void this.logSignaling(SOCKET_EVENTS.CONNECTION_INFO, data, data?.roomId);
    const roomId = (data.roomId || '').trim();
    if (!roomId) return;
    this.statsService.setFileRoomConnectionType(roomId, data.connectionType);
  }

  @SubscribeMessage(SOCKET_EVENTS.SDP_OFFER)
  handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; sdp: RTCSessionDescriptionInit },
  ) {
    void this.logSignaling(SOCKET_EVENTS.SDP_OFFER, data);
    this.server.to(data.targetPeerId).emit(SOCKET_EVENTS.SDP_OFFER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.SDP_ANSWER)
  handleSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; sdp: RTCSessionDescriptionInit },
  ) {
    void this.logSignaling(SOCKET_EVENTS.SDP_ANSWER, data);
    this.server.to(data.targetPeerId).emit(SOCKET_EVENTS.SDP_ANSWER, {
      senderPeerId: client.id,
      sdp: data.sdp,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.ICE_CANDIDATE)
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; candidate: RTCIceCandidateInit },
  ) {
    void this.logSignaling(SOCKET_EVENTS.ICE_CANDIDATE, data);
    this.server.to(data.targetPeerId).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
      senderPeerId: client.id,
      candidate: data.candidate,
    });
  }

  // Measures the real size of what this server received for the live "proof"
  // dashboard - the point being that this number stays tiny no matter how
  // large the file being transferred is.
  private async logSignaling(event: string, data: unknown, roomId?: string) {
    const sizeBytes = Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
    await this.statsService.recordSignalingMessage(event, sizeBytes, roomId);
  }
}
