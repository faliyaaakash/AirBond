import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;
  public readonly pubClient: Redis;
  public readonly subClient: Redis;

  private readonly ROOM_TTL = 7200; // 2 hours in seconds

  constructor(private config: ConfigService) {
    const redisOptions = {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(this.config.get<number>('REDIS_PORT', 6379)),
    };

    this.client = new Redis(redisOptions);
    this.pubClient = new Redis(redisOptions);
    this.subClient = new Redis(redisOptions);

    this.client.on('connect', () => this.logger.log('✅ Connected to Redis'));
    this.client.on('error', (err) => this.logger.error('❌ Redis Error:', err));
  }

  // Add peer socket ID to the room's Redis Set
  async addPeerToRoom(roomId: string, socketId: string): Promise<string[]> {
    const key = `room:${roomId}:peers`;

    // Fetch peers BEFORE adding new peer, OR filter after
    const allPeers = await this.client.smembers(key);
    const existingPeers = allPeers.filter((id) => id !== socketId);

    await this.client.sadd(key, socketId);
    await this.client.expire(key, this.ROOM_TTL);
    await this.client.set(
      `socket:${socketId}:room`,
      roomId,
      'EX',
      this.ROOM_TTL,
    );

    return existingPeers;
  }

  // Remove peer on disconnect and clean up empty rooms
  async removePeer(
    socketId: string,
  ): Promise<{ roomId: string | null; remainingPeers: string[] }> {
    const roomId = await this.client.get(`socket:${socketId}:room`);
    if (!roomId) return { roomId: null, remainingPeers: [] };

    const key = `room:${roomId}:peers`;
    await this.client.srem(key, socketId);
    await this.client.del(`socket:${socketId}:room`);

    const remainingPeers = await this.client.smembers(key);
    if (remainingPeers.length === 0) {
      await this.client.del(key);
    }

    return { roomId, remainingPeers };
  }

  // Get active peers for a room
  async getRoomPeers(roomId: string): Promise<string[]> {
    return this.client.smembers(`room:${roomId}:peers`);
  }

  onModuleDestroy() {
    this.client.disconnect();
    this.pubClient.disconnect();
    this.subClient.disconnect();
  }
}
