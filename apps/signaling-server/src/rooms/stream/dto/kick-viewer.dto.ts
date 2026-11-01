import { IsString, MaxLength, MinLength } from 'class-validator';

export class KickViewerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  viewerPeerId!: string;
}
