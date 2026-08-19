"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var RedisService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
let RedisService = RedisService_1 = class RedisService {
    config;
    logger = new common_1.Logger(RedisService_1.name);
    client;
    pubClient;
    subClient;
    ROOM_TTL = 7200;
    constructor(config) {
        this.config = config;
        const redisOptions = {
            host: this.config.get('REDIS_HOST', 'localhost'),
            port: Number(this.config.get('REDIS_PORT', 6379)),
        };
        this.client = new ioredis_1.default(redisOptions);
        this.pubClient = new ioredis_1.default(redisOptions);
        this.subClient = new ioredis_1.default(redisOptions);
        this.client.on('connect', () => this.logger.log('✅ Connected to Redis'));
        this.client.on('error', (err) => this.logger.error('❌ Redis Error:', err));
    }
    async addPeerToRoom(roomId, socketId) {
        const key = `room:${roomId}:peers`;
        const allPeers = await this.client.smembers(key);
        const existingPeers = allPeers.filter((id) => id !== socketId);
        await this.client.sadd(key, socketId);
        await this.client.expire(key, this.ROOM_TTL);
        await this.client.set(`socket:${socketId}:room`, roomId, 'EX', this.ROOM_TTL);
        return existingPeers;
    }
    async removePeer(socketId) {
        const roomId = await this.client.get(`socket:${socketId}:room`);
        if (!roomId)
            return { roomId: null, remainingPeers: [] };
        const key = `room:${roomId}:peers`;
        await this.client.srem(key, socketId);
        await this.client.del(`socket:${socketId}:room`);
        const remainingPeers = await this.client.smembers(key);
        if (remainingPeers.length === 0) {
            await this.client.del(key);
        }
        return { roomId, remainingPeers };
    }
    async getRoomPeers(roomId) {
        return this.client.smembers(`room:${roomId}:peers`);
    }
    onModuleDestroy() {
        this.client.disconnect();
        this.pubClient.disconnect();
        this.subClient.disconnect();
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = RedisService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RedisService);
//# sourceMappingURL=redis.service.js.map