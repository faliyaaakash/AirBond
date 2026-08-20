import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CHAT_ROOM_TTL_SECONDS } from './chat.constants';

export type ChatRoomDocument = HydratedDocument<ChatRoom>;

@Schema()
export class ChatRoom {
  @Prop({ required: true, unique: true })
  roomId!: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  roomName!: string;

  @Prop({ required: true, default: false })
  isPrivate!: boolean;

  @Prop()
  passwordHash?: string;

  @Prop({ required: true, default: Date.now })
  createdAt!: Date;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);

// TTL index: MongoDB's background task sweeps expired docs itself, independent of
// the app process. ChatRoomService additionally schedules an in-process timer so
// connected sockets get actively kicked at the same moment, not just whenever the
// TTL sweep next runs (it only checks every ~60s).
ChatRoomSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CHAT_ROOM_TTL_SECONDS },
);
