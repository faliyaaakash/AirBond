import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
export declare class RedisService implements OnModuleDestroy {
    private config;
    private readonly logger;
    readonly client: Redis;
    readonly pubClient: Redis;
    readonly subClient: Redis;
    private readonly ROOM_TTL;
    constructor(config: ConfigService);
    addPeerToRoom(roomId: string, socketId: string): Promise<string[]>;
    removePeer(socketId: string): Promise<{
        roomId: string | null;
        remainingPeers: string[];
    }>;
    getRoomPeers(roomId: string): Promise<string[]>;
    onModuleDestroy(): void;
}
