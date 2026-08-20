import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ChatRoomSummary } from '@airbond/shared';
import { ChatRoomService } from './chat-room.service';
import { ChatGateway } from './chat.gateway';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';

@Controller('chat/rooms')
export class ChatController {
  constructor(
    private readonly chatRoomService: ChatRoomService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post()
  async create(@Body() dto: CreateChatRoomDto): Promise<ChatRoomSummary> {
    const room = await this.chatRoomService.createRoom(
      dto.roomName,
      dto.isPrivate,
      dto.password,
      (roomId) => this.chatGateway.forceCloseRoom(roomId),
    );
    return this.chatRoomService.toSummary(room, 0);
  }

  @Get(':roomId')
  async get(@Param('roomId') roomId: string): Promise<ChatRoomSummary> {
    const room = await this.chatRoomService.findRoom(roomId);
    if (!room || this.chatRoomService.isExpired(room)) {
      throw new NotFoundException('Chat room not found or expired');
    }
    return this.chatRoomService.toSummary(
      room,
      this.chatGateway.getParticipantCount(roomId),
    );
  }
}
