import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { SubscriptionTier } from '../entities/Subscription';

/**
 * DTO for creating or upgrading a subscription.
 */
export class CreateSubscriptionDTO {
  @IsEnum(SubscriptionTier, {
    message: `Tier must be one of: ${Object.values(SubscriptionTier).join(', ')}`,
  })
  tier!: SubscriptionTier;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
