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
import { SOCKET_EVENTS } from '@airbond/shared';
import { RedisService } from '../../common/redis/redis.service';
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

  constructor(private readonly redisService: RedisService) {}

  afterInit() {
    console.log(' FileGateway WebSocket Server active on port 4000');
  }

  handleConnection(client: Socket) {
    console.log(`[Socket Connected]: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`[Socket Disconnected]: ${client.id}`);
    const { roomId } = await this.redisService.removePeer(client.id);
    if (roomId) {
      this.server
        .to(roomId)
        .emit(SOCKET_EVENTS.LEAVE_ROOM, { peerId: client.id });
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CREATE_ROOM)
  async handleCreateRoom(@ConnectedSocket() client: Socket) {
    const roomId = randomUUID().slice(0, 8);

    // Socket joins room
    await client.join(roomId);
    await this.redisService.addPeerToRoom(roomId, client.id); // Add Host socket ID to Redis room set
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

  @SubscribeMessage(SOCKET_EVENTS.SDP_OFFER)
  handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { targetPeerId: string; sdp: RTCSessionDescriptionInit },
  ) {
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
    this.server.to(data.targetPeerId).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
      senderPeerId: client.id,
      candidate: data.candidate,
    });
  }
}
