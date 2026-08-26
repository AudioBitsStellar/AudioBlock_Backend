import { IsArray, IsEnum, IsOptional, IsString, Length, IsNotEmpty } from 'class-validator';
import { Permission } from '../types/Permissions';

/**
 * DTO for issuing a new API key (Issue #89). Incorporates scopes and permissions.
 */
export class CreateApiKeyDTO {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(Permission, {
    each: true,
    message: `each permission must be one of: ${Object.values(Permission).join(', ')}`,
  })
  permissions?: Permission[];
}
