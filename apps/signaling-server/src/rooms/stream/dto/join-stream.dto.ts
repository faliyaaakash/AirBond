import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { StreamJoinSource } from '@airbond/shared';

export class JoinStreamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;

  @IsOptional()
  @IsIn(['discovery', 'code', 'link'])
  joinSource?: StreamJoinSource;
}
