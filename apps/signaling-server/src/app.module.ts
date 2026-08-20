import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './common/redis/redis.module';
import { FileGateway } from './rooms/files/files.gateway';
import { ChatModule } from './rooms/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule, // Added here to provide RedisService globally
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>(
          'MONGO_URI',
          'mongodb://localhost:27017/airbond',
        ),
      }),
    }),
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService, FileGateway],
})
export class AppModule {}
