import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  stageName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;
}
