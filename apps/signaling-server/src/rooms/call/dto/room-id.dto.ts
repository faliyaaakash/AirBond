import { IsString, MaxLength, MinLength } from 'class-validator';

// Shared shape for events that only need a room ID: leave-call.
export class RoomIdDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;
}
