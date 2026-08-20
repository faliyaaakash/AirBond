import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ChatRoomService } from './chat-room.service';
import { ChatRoom, ChatRoomDocument } from './chat-room.schema';
import { CHAT_ROOM_TTL_SECONDS } from './chat.constants';

type MockModel = {
  create: jest.Mock<Promise<ChatRoomDocument>, [Record<string, unknown>]>;
  findOne: jest.Mock;
  exists: jest.Mock;
  deleteOne: jest.Mock;
};

function makeRoom(overrides: Partial<ChatRoomDocument> = {}): ChatRoomDocument {
  return {
    roomId: 'abc12345',
    roomName: 'Test Room',
    isPrivate: false,
    passwordHash: undefined,
    createdAt: new Date(),
    ...overrides,
  } as ChatRoomDocument;
}

describe('ChatRoomService', () => {
  let service: ChatRoomService;
  let model: MockModel;

  beforeEach(async () => {
    model = {
      create: jest.fn<Promise<ChatRoomDocument>, [Record<string, unknown>]>(),
      findOne: jest.fn(),
      exists: jest.fn(),
      deleteOne: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChatRoomService,
        { provide: getModelToken(ChatRoom.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(ChatRoomService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createRoom', () => {
    it('creates a public room with no password hash', async () => {
      model.exists.mockResolvedValue(null);
      const created = makeRoom({ isPrivate: false });
      model.create.mockResolvedValue(created);

      const room = await service.createRoom(
        'Test Room',
        false,
        undefined,
        jest.fn(),
      );

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          roomName: 'Test Room',
          isPrivate: false,
          passwordHash: undefined,
        }),
      );
      expect(room).toBe(created);
    });

    it('hashes the password for a private room', async () => {
      model.exists.mockResolvedValue(null);
      model.create.mockImplementation((doc) => Promise.resolve(makeRoom(doc)));

      await service.createRoom('Secret', true, 'hunter22', jest.fn());

      const createCall = model.create.mock.calls[0][0];
      expect(createCall.passwordHash).toBeDefined();
      expect(createCall.passwordHash).not.toBe('hunter22');
    });

    it('retries room ID generation on collision', async () => {
      model.exists
        .mockResolvedValueOnce(true) // first candidate collides
        .mockResolvedValueOnce(null); // second candidate is free
      model.create.mockImplementation((doc) => Promise.resolve(makeRoom(doc)));

      await service.createRoom('Room', false, undefined, jest.fn());

      expect(model.exists).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting collision retries', async () => {
      model.exists.mockResolvedValue(true);

      await expect(
        service.createRoom('Room', false, undefined, jest.fn()),
      ).rejects.toThrow('Failed to generate a unique chat room ID');
    });
  });

  describe('findRoom', () => {
    it('queries by roomId', async () => {
      const room = makeRoom();
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(room),
      });

      const result = await service.findRoom('abc12345');

      expect(model.findOne).toHaveBeenCalledWith({ roomId: 'abc12345' });
      expect(result).toBe(room);
    });
  });

  describe('isExpired', () => {
    it('is false for a freshly created room', () => {
      const room = makeRoom({ createdAt: new Date() });
      expect(service.isExpired(room)).toBe(false);
    });

    it('is true once the TTL has elapsed', () => {
      const room = makeRoom({
        createdAt: new Date(Date.now() - (CHAT_ROOM_TTL_SECONDS + 60) * 1000),
      });
      expect(service.isExpired(room)).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('always passes for a public room', async () => {
      const room = makeRoom({ isPrivate: false });
      await expect(service.verifyPassword(room, undefined)).resolves.toBe(true);
    });

    it('rejects a private room join with no password supplied', async () => {
      const room = makeRoom({ isPrivate: true, passwordHash: 'somehash' });
      await expect(service.verifyPassword(room, undefined)).resolves.toBe(
        false,
      );
    });

    it('rejects the wrong password', async () => {
      model.exists.mockResolvedValue(null);
      model.create.mockImplementation((doc) => Promise.resolve(makeRoom(doc)));
      const created = await service.createRoom(
        'Secret',
        true,
        'correct-password',
        jest.fn(),
      );

      await expect(
        service.verifyPassword(created, 'wrong-password'),
      ).resolves.toBe(false);
    });

    it('accepts the correct password', async () => {
      model.exists.mockResolvedValue(null);
      model.create.mockImplementation((doc) => Promise.resolve(makeRoom(doc)));
      const created = await service.createRoom(
        'Secret',
        true,
        'correct-password',
        jest.fn(),
      );

      await expect(
        service.verifyPassword(created, 'correct-password'),
      ).resolves.toBe(true);
    });
  });

  describe('toSummary', () => {
    it('shapes the summary with a computed expiresAt', () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const room = makeRoom({
        roomId: 'xyz789',
        roomName: 'Room',
        isPrivate: true,
        createdAt,
      });

      const summary = service.toSummary(room, 3);

      expect(summary).toEqual({
        roomId: 'xyz789',
        roomName: 'Room',
        isPrivate: true,
        participantCount: 3,
        expiresAt: new Date(
          createdAt.getTime() + CHAT_ROOM_TTL_SECONDS * 1000,
        ).toISOString(),
      });
    });
  });

  describe('scheduleExpiry', () => {
    it('force-closes and deletes the room once the TTL elapses', async () => {
      jest.useFakeTimers();
      model.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(undefined),
      });
      const room = makeRoom({ roomId: 'expiring', createdAt: new Date() });
      const onExpire = jest.fn();

      service.scheduleExpiry(room, onExpire);
      expect(onExpire).not.toHaveBeenCalled();

      // The timer callback awaits a Mongo delete before calling onExpire, so the
      // fake-timer advance needs to flush that microtask too, not just fire the timer.
      await jest.advanceTimersByTimeAsync(CHAT_ROOM_TTL_SECONDS * 1000 + 1000);

      expect(onExpire).toHaveBeenCalledWith('expiring');
      expect(model.deleteOne).toHaveBeenCalledWith({ roomId: 'expiring' });
    });

    it('does not double-schedule the same room', () => {
      jest.useFakeTimers();
      const spy = jest.spyOn(global, 'setTimeout');
      const room = makeRoom({ roomId: 'once-only', createdAt: new Date() });

      service.scheduleExpiry(room, jest.fn());
      service.scheduleExpiry(room, jest.fn());

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('fires immediately for a room whose TTL has already elapsed', async () => {
      model.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(undefined),
      });
      const room = makeRoom({
        roomId: 'already-expired',
        createdAt: new Date(Date.now() - (CHAT_ROOM_TTL_SECONDS + 60) * 1000),
      });
      const onExpire = jest.fn();

      service.scheduleExpiry(room, onExpire);
      await Promise.resolve();
      await Promise.resolve();

      expect(onExpire).toHaveBeenCalledWith('already-expired');
    });
  });
});
