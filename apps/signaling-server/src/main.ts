import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
  });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(4000,'0.0.0.0');
  console.log('HTTP & Signaling Server running on http://localhost:4000');
}
bootstrap();
