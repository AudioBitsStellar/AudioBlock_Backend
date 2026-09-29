import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../entities/User';

/**
 * DTO for setting account type during Privy signup or profile update (Issue #616).
 *
 * Allows users to specify whether they are signing up as an artist or listener.
 * This distinction is important because artists get access to upload and royalty features.
 */
export class PrivyAccountTypeDTO {
  @IsEnum(UserRole)
  @IsNotEmpty()
  accountType!: UserRole.ARTIST | UserRole.LISTENER;

  @IsOptional()
  @IsString()
  artistName?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

/**
 * DTO for Privy login with account type selection (Issue #616).
 */
export class PrivyLoginDTO {
  @IsNotEmpty()
  @IsString()
  idToken!: string;

  @IsOptional()
  @IsEnum([UserRole.ARTIST, UserRole.LISTENER])
  accountType?: UserRole.ARTIST | UserRole.LISTENER;

  @IsOptional()
  @IsString()
  username?: string;
}
