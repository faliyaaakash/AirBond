import {
  IsBoolean,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateChatRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  roomName!: string;

  @IsBoolean()
  isPrivate!: boolean;

  @ValidateIf((dto: CreateChatRoomDto) => dto.isPrivate === true)
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;
}
