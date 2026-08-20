import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ReplyToDto } from './reply-to.dto';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roomId!: string;

  // Emptiness/length are enforced in the gateway handler so it can report the
  // specific MESSAGE_EMPTY / MESSAGE_TOO_LONG codes the client already handles.
  @IsString()
  text!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplyToDto)
  replyTo?: ReplyToDto;
}
