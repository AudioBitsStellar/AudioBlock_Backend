import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import {
  VERIFICATION_LINK_MAX_LENGTH,
  VERIFICATION_MAX_LINKS,
} from '../entities/ArtistVerification';

/**
 * DTO for submitting an artist verification application (Issue #92).
 */
export class ApplyVerificationDTO {
  @IsString()
  @Length(1, 200, { message: 'displayNameProof must be between 1 and 200 characters' })
  displayNameProof!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'at least one social link is required' })
  @ArrayMaxSize(VERIFICATION_MAX_LINKS)
  @IsUrl(
    { protocols: ['http', 'https'] },
    { each: true, message: 'each social link must be a valid http(s) URL' },
  )
  @Length(1, VERIFICATION_LINK_MAX_LENGTH, { each: true })
  socialLinks!: string[];

  @IsArray()
  @ArrayMinSize(1, { message: 'at least one music link is required' })
  @ArrayMaxSize(VERIFICATION_MAX_LINKS)
  @IsUrl(
    { protocols: ['http', 'https'] },
    { each: true, message: 'each music link must be a valid http(s) URL' },
  )
  @Length(1, VERIFICATION_LINK_MAX_LENGTH, { each: true })
  musicLinks!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
