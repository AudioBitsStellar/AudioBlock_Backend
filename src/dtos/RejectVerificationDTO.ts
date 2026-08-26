import { IsString, Length } from 'class-validator';
import { VERIFICATION_REASON_MAX_LENGTH } from '../entities/ArtistVerification';

/**
 * DTO for rejecting an artist verification application (Issue #92).
 * A reason is mandatory so the applicant learns what to fix.
 */
export class RejectVerificationDTO {
  @IsString()
  @Length(1, VERIFICATION_REASON_MAX_LENGTH, {
    message: `reason must be between 1 and ${VERIFICATION_REASON_MAX_LENGTH} characters`,
  })
  reason!: string;
}
