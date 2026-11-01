import { IsString, MaxLength, MinLength } from 'class-validator';

export class StreamMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  displayName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}
