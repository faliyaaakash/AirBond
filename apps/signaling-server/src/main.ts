import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as fs from 'fs';
import * as path from 'path';

// A page served over https:// can't open a plain ws:// connection (browsers
// block it as mixed content) - so once the web app is on HTTPS (see
// apps/web/vite.config.ts), this server needs to be too, using the same
// mkcert-generated cert. Falls back to plain HTTP if the certs aren't there.
const certPath = path.resolve(__dirname, '../../../infra/certs/dev-cert.pem');
const keyPath = path.resolve(__dirname, '../../../infra/certs/dev-key.pem');
const httpsOptions =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : undefined);
  app.enableCors({
    origin: '*',
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(4000, '0.0.0.0');
  const scheme = httpsOptions ? 'https' : 'http';
  console.log(`HTTP & Signaling Server running on ${scheme}://localhost:4000`);
}
void bootstrap();
