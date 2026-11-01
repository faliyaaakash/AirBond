import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;
}
