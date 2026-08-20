import { Test, TestingModule } from '@nestjs/testing';
import { StatsService } from './stats.service';
import { RedisService } from '../common/redis/redis.service';

function makeMockPipeline() {
  const pipeline = {
    hincrby: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    hgetall: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  return pipeline;
}

describe('StatsService', () => {
  let service: StatsService;
  let redisClient: {
    pipeline: jest.Mock;
    get: jest.Mock;
    incr: jest.Mock;
    incrby: jest.Mock;
  };

  beforeEach(async () => {
    redisClient = {
      pipeline: jest.fn(() => makeMockPipeline()),
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      incrby: jest.fn().mockResolvedValue(1),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: RedisService, useValue: { client: redisClient } },
      ],
    }).compile();

    service = moduleRef.get(StatsService);
  });

  describe('file rooms', () => {
    it('tracks a new room and reflects it in the snapshot', async () => {
      service.setFileRoomPeerCount('room1', 2);

      const snapshot = await service.getSnapshot();

      expect(snapshot.fileRooms).toHaveLength(1);
      expect(snapshot.fileRooms[0]).toMatchObject({
        roomId: 'room1',
        peerCount: 2,
      });
      expect(snapshot.totals.activeFileRooms).toBe(1);
      expect(snapshot.totals.connectedFilePeers).toBe(2);
    });

    it('drops a room once its peer count reaches zero', async () => {
      service.setFileRoomPeerCount('room1', 2);
      service.setFileRoomPeerCount('room1', 0);

      const snapshot = await service.getSnapshot();

      expect(snapshot.fileRooms).toHaveLength(0);
    });

    it('ignores progress for a room that is not tracked', async () => {
      await service.recordFileTransferProgress(
        'untracked',
        's1',
        'send',
        'a.txt',
        100,
        50,
      );

      expect(redisClient.incrby).not.toHaveBeenCalled();
    });

    it('records only the incremental delta of bytes transferred', async () => {
      service.setFileRoomPeerCount('room1', 1);

      await service.recordFileTransferProgress(
        'room1',
        's1',
        'send',
        'a.txt',
        1000,
        200,
      );
      await service.recordFileTransferProgress(
        'room1',
        's1',
        'send',
        'a.txt',
        1000,
        500,
      );

      expect(redisClient.incrby).toHaveBeenNthCalledWith(
        1,
        'stats:total:fileBytes',
        200,
      );
      expect(redisClient.incrby).toHaveBeenNthCalledWith(
        2,
        'stats:total:fileBytes',
        300,
      );

      const snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].activeTransfers).toEqual([
        {
          direction: 'send',
          fileName: 'a.txt',
          fileSize: 1000,
          bytesTransferred: 500,
        },
      ]);
    });

    it('removes a completed transfer from the active list after a short delay', async () => {
      jest.useFakeTimers();
      service.setFileRoomPeerCount('room1', 1);

      await service.recordFileTransferProgress(
        'room1',
        's1',
        'send',
        'a.txt',
        1000,
        1000,
      );
      let snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].activeTransfers).toHaveLength(1);

      jest.advanceTimersByTime(3100);
      snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].activeTransfers).toHaveLength(0);

      jest.useRealTimers();
    });
  });

  describe('chat rooms', () => {
    it('tracks a new chat room and reflects it in the snapshot', async () => {
      service.upsertChatRoom(
        'room1',
        'Room One',
        false,
        2,
        new Date('2026-01-01T02:00:00.000Z'),
      );

      const snapshot = await service.getSnapshot();

      expect(snapshot.chatRooms).toHaveLength(1);
      expect(snapshot.chatRooms[0]).toMatchObject({
        roomId: 'room1',
        roomName: 'Room One',
        participantCount: 2,
        messageCount: 0,
      });
    });

    it('updates participant count without touching other fields', async () => {
      service.upsertChatRoom('room1', 'Room One', false, 2, new Date());
      service.setChatRoomParticipantCount('room1', 1);

      const snapshot = await service.getSnapshot();
      expect(snapshot.chatRooms[0].participantCount).toBe(1);
      expect(snapshot.chatRooms[0].roomName).toBe('Room One');
    });

    it('drops the room once participant count reaches zero', async () => {
      service.upsertChatRoom('room1', 'Room One', false, 1, new Date());
      service.setChatRoomParticipantCount('room1', 0);

      const snapshot = await service.getSnapshot();
      expect(snapshot.chatRooms).toHaveLength(0);
    });

    it('removeChatRoom drops the room outright', async () => {
      service.upsertChatRoom('room1', 'Room One', false, 1, new Date());
      service.removeChatRoom('room1');

      const snapshot = await service.getSnapshot();
      expect(snapshot.chatRooms).toHaveLength(0);
    });

    it('increments the message count for a tracked room', async () => {
      service.upsertChatRoom('room1', 'Room One', false, 1, new Date());

      await service.recordChatMessage('room1');
      await service.recordChatMessage('room1');

      const snapshot = await service.getSnapshot();
      expect(snapshot.chatRooms[0].messageCount).toBe(2);
      expect(redisClient.incr).toHaveBeenCalledWith('stats:total:chatMessages');
    });
  });

  describe('getSnapshot totals', () => {
    it('reads lifetime totals from Redis', async () => {
      redisClient.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'stats:total:fileBytes' ? '12345' : '7'),
      );

      const snapshot = await service.getSnapshot();

      expect(snapshot.totals.totalFileBytesTracked).toBe(12345);
      expect(snapshot.totals.totalChatMessagesTracked).toBe(7);
    });
  });

  describe('connection type', () => {
    it('defaults to unknown for a newly tracked room', async () => {
      service.setFileRoomPeerCount('room1', 1);

      const snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].connectionType).toBe('unknown');
    });

    it('records a reported connection type', async () => {
      service.setFileRoomPeerCount('room1', 1);
      service.setFileRoomConnectionType('room1', 'direct');

      const snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].connectionType).toBe('direct');
    });

    it('does not let a later "unknown" overwrite an already-observed relay', async () => {
      service.setFileRoomPeerCount('room1', 2);
      service.setFileRoomConnectionType('room1', 'relay');
      service.setFileRoomConnectionType('room1', 'unknown');

      const snapshot = await service.getSnapshot();
      expect(snapshot.fileRooms[0].connectionType).toBe('relay');
    });

    it('is a no-op for a room that is not tracked', () => {
      expect(() =>
        service.setFileRoomConnectionType('untracked', 'direct'),
      ).not.toThrow();
    });
  });

  describe('signaling wire log', () => {
    it('records the event with its real size and increments the total', async () => {
      await service.recordSignalingMessage('sdp-offer', 612, 'room1');

      const snapshot = await service.getSnapshot();
      expect(snapshot.recentEvents[0]).toMatchObject({
        event: 'sdp-offer',
        sizeBytes: 612,
        roomId: 'room1',
      });
      expect(redisClient.incrby).toHaveBeenCalledWith(
        'stats:total:signalingBytes',
        612,
      );
    });

    it('orders events newest-first', async () => {
      await service.recordSignalingMessage('first', 10);
      await service.recordSignalingMessage('second', 20);

      const snapshot = await service.getSnapshot();
      expect(snapshot.recentEvents[0].event).toBe('second');
      expect(snapshot.recentEvents[1].event).toBe('first');
    });

    it('caps the log at 40 entries', async () => {
      for (let i = 0; i < 45; i++) {
        await service.recordSignalingMessage(`event-${i}`, 1);
      }

      const snapshot = await service.getSnapshot();
      expect(snapshot.recentEvents).toHaveLength(40);
      expect(snapshot.recentEvents[0].event).toBe('event-44');
    });
  });
});
