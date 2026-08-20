import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class ReactMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  messageId!: string;

  @IsBoolean()
  reacted!: boolean;
}
