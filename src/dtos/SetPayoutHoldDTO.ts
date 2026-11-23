import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for `PUT /api/admin/users/:id/payout-hold` — places or clears a payout hold (#985). */
export class SetPayoutHoldDTO {
  @IsBoolean()
  hold!: boolean;

  /** Free-text reason, recorded on the hold and in the audit log. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
