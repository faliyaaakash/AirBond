import { Module } from '@nestjs/common';
import { StreamRoomService } from './stream-room.service';
import { StreamGateway } from './stream.gateway';

@Module({
  providers: [StreamRoomService, StreamGateway],
})
export class StreamModule {}
