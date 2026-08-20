import { IsString, MaxLength, MinLength } from 'class-validator';

// Supplied by the replying client (see ChatReplyPreview in @airbond/shared) — the
// server never stores messages, so it can't look this up itself; it just relays
// whatever context the client already had rendered locally.
export class ReplyToDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  messageId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  stageName!: string;

  @IsString()
  @MaxLength(200)
  snippet!: string;
}
