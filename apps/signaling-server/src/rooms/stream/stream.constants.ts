// Single source of truth for the stream room lifetime, mirroring
// CHAT_ROOM_TTL_SECONDS - same 2h ephemeral window as the rest of the app.
export const STREAM_ROOM_TTL_SECONDS =
  Number(process.env.STREAM_ROOM_TTL_SECONDS) || 7200;
