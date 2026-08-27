import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum } from 'class-validator';
import { ApiKeyScope } from '../entities/ApiKey';

export class CreateApiKeyDTO {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsEnum(ApiKeyScope, { each: true })
  scopes?: ApiKeyScope[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
