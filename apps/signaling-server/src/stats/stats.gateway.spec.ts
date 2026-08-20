import { StatsGateway } from './stats.gateway';
import { StatsService } from './stats.service';
import { STATS_EVENTS } from '@airbond/shared';

function makeMockSocket(authCode?: string) {
  return {
    id: 'socket1',
    handshake: { auth: { code: authCode } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('StatsGateway', () => {
  let statsService: jest.Mocked<Pick<StatsService, 'getSnapshot'>>;
  let config: { get: jest.Mock };
  let gateway: StatsGateway;

  const fakeSnapshot = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    totals: {
      activeFileRooms: 0,
      activeChatRooms: 0,
      connectedFilePeers: 0,
      connectedChatPeers: 0,
      totalFileBytesTracked: 0,
      totalChatMessagesTracked: 0,
    },
    fileRooms: [],
    chatRooms: [],
    traffic: [],
  };

  beforeEach(() => {
    statsService = { getSnapshot: jest.fn().mockResolvedValue(fakeSnapshot) };
    config = { get: jest.fn().mockReturnValue('secret-code') };
    gateway = new StatsGateway(
      statsService as unknown as StatsService,
      config as never,
    );
  });

  it('rejects a connection with the wrong passcode', () => {
    const socket = makeMockSocket('wrong-code');

    gateway.handleConnection(socket as never);

    expect(socket.emit).toHaveBeenCalledWith(
      STATS_EVENTS.AUTH_ERROR,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is inherently `any`-typed
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a connection with no passcode at all', () => {
    const socket = makeMockSocket(undefined);

    gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects every connection when no access code is configured (fail closed)', () => {
    config.get.mockReturnValue(undefined);
    const socket = makeMockSocket('anything');

    gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('accepts a connection with the correct passcode and sends a snapshot', async () => {
    const socket = makeMockSocket('secret-code');

    gateway.handleConnection(socket as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      STATS_EVENTS.SNAPSHOT,
      fakeSnapshot,
    );
  });
});
