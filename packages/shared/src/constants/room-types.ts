export const ROOM_TYPES = ['video', 'file', 'chat'] as const;
 export type RoomType = typeof ROOM_TYPES[number];