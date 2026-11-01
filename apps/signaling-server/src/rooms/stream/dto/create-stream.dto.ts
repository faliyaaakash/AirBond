import {
  IsBoolean,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsBoolean()
  isPrivate!: boolean;

  @ValidateIf((dto: CreateStreamDto) => dto.isPrivate === true)
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;
}
