import { Global, Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsGateway } from './stats.gateway';

@Global()
@Module({
  providers: [StatsService, StatsGateway],
  exports: [StatsService],
})
export class StatsModule {}
