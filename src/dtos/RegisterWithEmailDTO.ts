import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  IsNotEmpty,
} from 'class-validator';
import { UserRole } from '../entities/User';

export class RegisterWithEmailDTO {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password!: string;

  @IsEnum(UserRole)
  @IsNotEmpty({ message: 'Role is required.' })
  role!: UserRole;

  /**
   * Self-declared date of birth, `YYYY-MM-DD`, checked against the minimum signup age
   * (docs/AGE_POLICY.md). It is used for the check only and is never persisted.
   */
  @IsString()
  @IsNotEmpty({ message: 'Date of birth is required.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be in YYYY-MM-DD format.' })
  dateOfBirth!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
