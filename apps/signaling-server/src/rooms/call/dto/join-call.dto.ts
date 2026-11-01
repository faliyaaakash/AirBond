import { IsString, MaxLength, MinLength } from 'class-validator';

export class JoinCallDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;
}
