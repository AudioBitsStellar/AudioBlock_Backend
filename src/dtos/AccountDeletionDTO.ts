import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of `POST /api/account/deletion-request`. */
export class RequestAccountDeletionDTO {
  /**
   * Optional free-text reason. Stored on the account so support can distinguish a
   * churn cancellation from a rights-based request, and length-capped so the
   * column cannot be used as unbounded storage.
   */
  @IsString({ message: 'reason must be a string' })
  @MaxLength(500, { message: 'reason must be 500 characters or fewer' })
  @IsOptional()
  reason?: string;

  /**
   * Explicit confirmation. The endpoint is irreversible after the grace window, so
   * require the client to opt in rather than inferring intent from the request
   * alone (Art. 12(3) requires confirmation of a rights request).
   */
  @IsBoolean({ message: 'confirm must be a boolean' })
  @Type(() => Boolean)
  confirm!: boolean;
}
