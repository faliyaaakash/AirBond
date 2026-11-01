import {
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TrackStateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsBoolean()
  micEnabled!: boolean;

  @IsBoolean()
  cameraEnabled!: boolean;

  @IsIn(['camera', 'screen'])
  videoSource!: 'camera' | 'screen';
}
