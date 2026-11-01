// Same 2h ephemeral window as every other room type (STREAM_ROOM_TTL_SECONDS,
// CHAT_ROOM_TTL_SECONDS) - a call left open and unused still force-closes.
export const CALL_ROOM_TTL_SECONDS =
  Number(process.env.CALL_ROOM_TTL_SECONDS) || 7200;
