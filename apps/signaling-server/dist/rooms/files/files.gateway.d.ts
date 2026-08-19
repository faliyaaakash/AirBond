import { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../../common/redis/redis.service';
export declare class FileGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly redisService;
    server: Server;
    constructor(redisService: RedisService);
    afterInit(server: Server): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): Promise<void>;
    handleCreateRoom(client: Socket): Promise<void>;
    handleJoinRoom(client: Socket, data: {
        roomId: string;
    }): Promise<void>;
    handleSdpOffer(client: Socket, data: {
        targetPeerId: string;
        sdp: RTCSessionDescriptionInit;
    }): void;
    handleSdpAnswer(client: Socket, data: {
        targetPeerId: string;
        sdp: RTCSessionDescriptionInit;
    }): void;
    handleIceCandidate(client: Socket, data: {
        targetPeerId: string;
        candidate: RTCIceCandidateInit;
    }): void;
}
