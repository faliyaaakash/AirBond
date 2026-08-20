// Single source of truth for the chat room lifetime, read once at module load.
// Shared between the schema's TTL index and the service's in-process expiry timers,
// so the two can never drift apart.
export const CHAT_ROOM_TTL_SECONDS =
  Number(process.env.CHAT_ROOM_TTL_SECONDS) || 7200;
