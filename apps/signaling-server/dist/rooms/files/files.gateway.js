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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const shared_1 = require("@airbond/shared");
const redis_service_1 = require("../../common/redis/redis.service");
const crypto_1 = require("crypto");
let FileGateway = class FileGateway {
    redisService;
    server;
    constructor(redisService) {
        this.redisService = redisService;
    }
    afterInit(server) {
        console.log(' FileGateway WebSocket Server active on port 4000');
    }
    handleConnection(client) {
        console.log(`[Socket Connected]: ${client.id}`);
    }
    async handleDisconnect(client) {
        console.log(`[Socket Disconnected]: ${client.id}`);
        const { roomId } = await this.redisService.removePeer(client.id);
        if (roomId) {
            this.server.to(roomId).emit(shared_1.SOCKET_EVENTS.LEAVE_ROOM, { peerId: client.id });
        }
    }
    async handleCreateRoom(client) {
        const roomId = (0, crypto_1.randomUUID)().slice(0, 8);
        await client.join(roomId);
        await this.redisService.addPeerToRoom(roomId, client.id);
        client.emit(shared_1.SOCKET_EVENTS.ROOM_CREATED, { roomId });
        console.log(`[Room Created]: ${roomId} by Host ${client.id}`);
    }
    async handleJoinRoom(client, data) {
        const cleanRoomId = (data.roomId || '').trim();
        if (!cleanRoomId)
            return;
        await client.join(cleanRoomId);
        const existingPeers = await this.redisService.addPeerToRoom(cleanRoomId, client.id);
        console.log(`Peer ${client.id} joined room ${cleanRoomId}. Existing peers found in Redis:`, existingPeers);
        client.emit('room-users', { peers: existingPeers });
        client.to(cleanRoomId).emit(shared_1.SOCKET_EVENTS.PEER_JOINED, { peerId: client.id });
    }
    handleSdpOffer(client, data) {
        this.server.to(data.targetPeerId).emit(shared_1.SOCKET_EVENTS.SDP_OFFER, {
            senderPeerId: client.id,
            sdp: data.sdp,
        });
    }
    handleSdpAnswer(client, data) {
        this.server.to(data.targetPeerId).emit(shared_1.SOCKET_EVENTS.SDP_ANSWER, {
            senderPeerId: client.id,
            sdp: data.sdp,
        });
    }
    handleIceCandidate(client, data) {
        this.server.to(data.targetPeerId).emit(shared_1.SOCKET_EVENTS.ICE_CANDIDATE, {
            senderPeerId: client.id,
            candidate: data.candidate,
        });
    }
};
exports.FileGateway = FileGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], FileGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.CREATE_ROOM),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], FileGateway.prototype, "handleCreateRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.JOIN_ROOM),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], FileGateway.prototype, "handleJoinRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.SDP_OFFER),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], FileGateway.prototype, "handleSdpOffer", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.SDP_ANSWER),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], FileGateway.prototype, "handleSdpAnswer", null);
__decorate([
    (0, websockets_1.SubscribeMessage)(shared_1.SOCKET_EVENTS.ICE_CANDIDATE),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], FileGateway.prototype, "handleIceCandidate", null);
exports.FileGateway = FileGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
    }),
    __metadata("design:paramtypes", [redis_service_1.RedisService])
], FileGateway);
//# sourceMappingURL=files.gateway.js.map