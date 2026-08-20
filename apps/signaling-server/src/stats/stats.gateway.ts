import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { STATS_EVENTS } from '@airbond/shared';
import { StatsService } from './stats.service';

const BROADCAST_INTERVAL_MS = 1500;

// Read-only dashboard feed. A client must present the correct passcode in the
// Socket.IO handshake auth payload to receive anything; otherwise it's
// disconnected immediately without ever seeing a snapshot.
@WebSocketGateway({
  namespace: '/stats',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class StatsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(StatsGateway.name);

  constructor(
    private readonly statsService: StatsService,
    private readonly config: ConfigService,
  ) {}

  afterInit() {
    const timer = setInterval(
      () => void this.broadcastSnapshot(),
      BROADCAST_INTERVAL_MS,
    );
    timer.unref();
  }

  handleConnection(client: Socket) {
    const expectedCode = this.config.get<string>('DASHBOARD_ACCESS_CODE');
    const providedCode = client.handshake.auth?.code as string | undefined;

    if (!expectedCode || providedCode !== expectedCode) {
      client.emit(STATS_EVENTS.AUTH_ERROR, {
        message: 'Invalid dashboard passcode.',
      });
      client.disconnect(true);
      return;
    }

    void this.statsService
      .getSnapshot()
      .then((snapshot) => client.emit(STATS_EVENTS.SNAPSHOT, snapshot));
    this.logger.log(`Dashboard client connected: ${client.id}`);
  }

  private async broadcastSnapshot() {
    const snapshot = await this.statsService.getSnapshot();
    this.server.emit(STATS_EVENTS.SNAPSHOT, snapshot);
  }
}
