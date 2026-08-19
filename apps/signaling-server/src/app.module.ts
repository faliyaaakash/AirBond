import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './common/redis/redis.module';
import { FileGateway } from './rooms/files/files.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule, // Added here to provide RedisService globally
  ],
  controllers: [AppController],
  providers: [AppService, FileGateway],
})
export class AppModule {}
