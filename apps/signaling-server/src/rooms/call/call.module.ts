import { Module } from '@nestjs/common';
import { CallRoomService } from './call-room.service';
import { CallGateway } from './call.gateway';

@Module({
  providers: [CallRoomService, CallGateway],
})
export class CallModule {}
