import type { ChatRoomSummary, CreateChatRoomRequest } from '@airbond/shared';

const BASE_URL = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export async function createChatRoom(
  request: CreateChatRoomRequest,
): Promise<ChatRoomSummary> {
  const res = await fetch(`${BASE_URL}/chat/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return parseJsonOrThrow<ChatRoomSummary>(res);
}

export async function fetchChatRoom(roomId: string): Promise<ChatRoomSummary> {
  const res = await fetch(`${BASE_URL}/chat/rooms/${encodeURIComponent(roomId)}`);
  return parseJsonOrThrow<ChatRoomSummary>(res);
}
