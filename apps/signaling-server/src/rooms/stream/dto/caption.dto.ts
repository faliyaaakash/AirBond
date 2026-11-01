import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class CaptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @IsBoolean()
  isFinal!: boolean;
}
