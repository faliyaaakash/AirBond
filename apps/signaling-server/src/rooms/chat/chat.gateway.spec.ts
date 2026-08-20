import { ChatGateway } from './chat.gateway';
import { ChatRoomService } from './chat-room.service';
import { ChatRoomDocument } from './chat-room.schema';
import { CHAT_EVENTS } from '@airbond/shared';

function makeRoom(overrides: Partial<ChatRoomDocument> = {}): ChatRoomDocument {
  return {
    roomId: 'room1',
    roomName: 'Test Room',
    isPrivate: false,
    passwordHash: undefined,
    createdAt: new Date(),
    ...overrides,
  } as ChatRoomDocument;
}

function makeMockSocket(id: string) {
  const toEmit = jest.fn();
  const socket = {
    id,
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    to: jest.fn(() => ({ emit: toEmit })),
  };
  return { socket, toEmit };
}

function makeMockServer() {
  const toEmit = jest.fn();
  const socketsLeave = jest.fn();
  const server = {
    to: jest.fn(() => ({ emit: toEmit })),
    in: jest.fn(() => ({ socketsLeave })),
  };
  return { server, toEmit, socketsLeave };
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatRoomService: jest.Mocked<
    Pick<
      ChatRoomService,
      | 'findRoom'
      | 'isExpired'
      | 'verifyPassword'
      | 'scheduleExpiry'
      | 'toSummary'
    >
  >;
  let server: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    chatRoomService = {
      findRoom: jest.fn(),
      isExpired: jest.fn().mockReturnValue(false),
      verifyPassword: jest.fn().mockResolvedValue(true),
      scheduleExpiry: jest.fn(),
      toSummary: jest
        .fn()
        .mockImplementation(
          (room: ChatRoomDocument, participantCount: number) => ({
            roomId: room.roomId,
            roomName: room.roomName,
            isPrivate: room.isPrivate,
            participantCount,
            expiresAt: '2026-01-01T02:00:00.000Z',
          }),
        ),
    };
    gateway = new ChatGateway(chatRoomService as unknown as ChatRoomService);
    server = makeMockServer();
    gateway.server = server.server as never;
  });

  describe('handleJoinRoom', () => {
    it('rejects a malformed payload', async () => {
      const { socket } = makeMockSocket('s1');
      await gateway.handleJoinRoom(socket as never, {
        roomId: '',
        stageName: '',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_ERROR,
        expect.objectContaining({ reason: 'INVALID_INPUT' }),
      );
    });

    it('rejects when the room does not exist', async () => {
      chatRoomService.findRoom.mockResolvedValue(null);
      const { socket } = makeMockSocket('s1');

      await gateway.handleJoinRoom(socket as never, {
        roomId: 'nope',
        stageName: 'Alice',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_ERROR,
        expect.objectContaining({ reason: 'ROOM_NOT_FOUND' }),
      );
    });

    it('rejects an expired room', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      chatRoomService.isExpired.mockReturnValue(true);
      const { socket } = makeMockSocket('s1');

      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_ERROR,
        expect.objectContaining({ reason: 'ROOM_EXPIRED' }),
      );
    });

    it('rejects an incorrect password', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom({ isPrivate: true }));
      chatRoomService.verifyPassword.mockResolvedValue(false);
      const { socket } = makeMockSocket('s1');

      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
        password: 'wrong',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_ERROR,
        expect.objectContaining({ reason: 'INVALID_PASSWORD' }),
      );
    });

    it('rejects a stage name already taken in the room (case-insensitive)', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket: first } = makeMockSocket('s1');
      await gateway.handleJoinRoom(first as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      const { socket: second } = makeMockSocket('s2');
      await gateway.handleJoinRoom(second as never, {
        roomId: 'room1',
        stageName: 'alice',
      });

      expect(second.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_ERROR,
        expect.objectContaining({ reason: 'NAME_TAKEN' }),
      );
    });

    it('joins successfully and notifies existing participants', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket, toEmit } = makeMockSocket('s1');

      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      expect(socket.join).toHaveBeenCalledWith('room1');
      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.JOIN_SUCCESS,
        expect.objectContaining({
          roomId: 'room1',
          participants: [{ socketId: 's1', stageName: 'Alice' }],
        }),
      );
      expect(toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.USER_JOINED,
        expect.objectContaining({ stageName: 'Alice', participantCount: 1 }),
      );
      expect(chatRoomService.scheduleExpiry).toHaveBeenCalled();
    });
  });

  describe('handleSendMessage', () => {
    async function joinRoom(id: string, stageName: string) {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket } = makeMockSocket(id);
      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName,
      });
      return socket;
    }

    it('does nothing for a socket that has not joined the room', async () => {
      const { socket } = makeMockSocket('ghost');
      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'hi',
      });

      expect(server.toEmit).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('rejects an empty message', async () => {
      const socket = await joinRoom('s1', 'Alice');
      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: '   ',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.CHAT_ERROR,
        expect.objectContaining({ code: 'MESSAGE_EMPTY' }),
      );
    });

    it('rejects a message over the length limit', async () => {
      const socket = await joinRoom('s1', 'Alice');
      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'x'.repeat(2001),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.CHAT_ERROR,
        expect.objectContaining({ code: 'MESSAGE_TOO_LONG' }),
      );
    });

    it('broadcasts a valid message to the room with a server-assigned messageId', async () => {
      const socket = await joinRoom('s1', 'Alice');
      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'Hello!',
      });

      expect(server.toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.NEW_MESSAGE,
        expect.objectContaining({
          stageName: 'Alice',
          text: 'Hello!',
          messageId: expect.any(String),
        }),
      );
    });

    it('relays a reply-to preview supplied by the client as-is', async () => {
      const socket = await joinRoom('s1', 'Alice');
      const replyTo = { messageId: 'earlier-id', stageName: 'Bob', snippet: 'original text' };

      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'replying now',
        replyTo,
      });

      expect(server.toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.NEW_MESSAGE,
        expect.objectContaining({ text: 'replying now', replyTo }),
      );
    });

    it('rejects a reply-to payload that fails validation', async () => {
      const socket = await joinRoom('s1', 'Alice');

      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'replying now',
        replyTo: { messageId: '', stageName: 'Bob', snippet: 'x' },
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.CHAT_ERROR,
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
      expect(server.toEmit).not.toHaveBeenCalled();
    });

    it('rate-limits after too many messages in the window', async () => {
      const socket = await joinRoom('s1', 'Alice');
      for (let i = 0; i < 10; i++) {
        await gateway.handleSendMessage(socket as never, {
          roomId: 'room1',
          text: `msg ${i}`,
        });
      }
      await gateway.handleSendMessage(socket as never, {
        roomId: 'room1',
        text: 'one too many',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        CHAT_EVENTS.CHAT_ERROR,
        expect.objectContaining({ code: 'RATE_LIMITED' }),
      );
    });
  });

  describe('handleReactMessage', () => {
    async function joinRoom(id: string, stageName: string) {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket } = makeMockSocket(id);
      await gateway.handleJoinRoom(socket as never, { roomId: 'room1', stageName });
      return socket;
    }

    it('does nothing for a socket that has not joined the room', async () => {
      const { socket } = makeMockSocket('ghost');
      await gateway.handleReactMessage(socket as never, {
        roomId: 'room1',
        messageId: 'msg-1',
        reacted: true,
      });

      expect(server.toEmit).not.toHaveBeenCalled();
    });

    it('broadcasts the reaction toggle to the room', async () => {
      const socket = await joinRoom('s1', 'Alice');

      await gateway.handleReactMessage(socket as never, {
        roomId: 'room1',
        messageId: 'msg-1',
        reacted: true,
      });

      expect(server.toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.MESSAGE_REACTED,
        expect.objectContaining({ messageId: 'msg-1', stageName: 'Alice', reacted: true }),
      );
    });

    it('ignores a malformed payload', async () => {
      const socket = await joinRoom('s1', 'Alice');

      await gateway.handleReactMessage(socket as never, { roomId: 'room1' });

      expect(server.toEmit).not.toHaveBeenCalled();
    });
  });

  describe('typing indicators', () => {
    it('broadcasts typing-start/stop only for joined participants', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket, toEmit } = makeMockSocket('s1');
      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      await gateway.handleTypingStart(socket as never, { roomId: 'room1' });
      expect(toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.USER_TYPING,
        expect.objectContaining({ stageName: 'Alice', isTyping: true }),
      );

      await gateway.handleTypingStop(socket as never, { roomId: 'room1' });
      expect(toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.USER_TYPING,
        expect.objectContaining({ stageName: 'Alice', isTyping: false }),
      );
    });

    it('does nothing for a non-participant', async () => {
      const { socket, toEmit } = makeMockSocket('ghost');
      await gateway.handleTypingStart(socket as never, { roomId: 'room1' });
      expect(toEmit).not.toHaveBeenCalled();
    });
  });

  describe('leaving', () => {
    it('handleLeaveRoom removes the participant and notifies the room', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket, toEmit } = makeMockSocket('s1');
      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      await gateway.handleLeaveRoom(socket as never, { roomId: 'room1' });

      expect(socket.leave).toHaveBeenCalledWith('room1');
      expect(toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.USER_LEFT,
        expect.objectContaining({ stageName: 'Alice', participantCount: 0 }),
      );
      expect(gateway.getParticipantCount('room1')).toBe(0);
    });

    it('handleDisconnect removes the socket from every room it was in', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket, toEmit } = makeMockSocket('s1');
      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      gateway.handleDisconnect(socket as never);

      expect(toEmit).toHaveBeenCalledWith(
        CHAT_EVENTS.USER_LEFT,
        expect.objectContaining({ stageName: 'Alice' }),
      );
      expect(gateway.getParticipantCount('room1')).toBe(0);
    });
  });

  describe('forceCloseRoom', () => {
    it('emits room-closed, evicts sockets and clears participant state', async () => {
      chatRoomService.findRoom.mockResolvedValue(makeRoom());
      const { socket } = makeMockSocket('s1');
      await gateway.handleJoinRoom(socket as never, {
        roomId: 'room1',
        stageName: 'Alice',
      });

      gateway.forceCloseRoom('room1');

      expect(server.toEmit).toHaveBeenCalledWith(CHAT_EVENTS.ROOM_CLOSED, {
        reason: 'EXPIRED',
      });
      expect(server.socketsLeave).toHaveBeenCalledWith('room1');
      expect(gateway.getParticipantCount('room1')).toBe(0);
    });
  });
});
