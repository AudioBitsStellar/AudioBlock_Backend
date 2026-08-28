import { IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { SubscriptionTier } from '../entities/Subscription';

export class CreateTrialSubscriptionDTO {
  @IsEnum(SubscriptionTier)
  tier!: SubscriptionTier;

  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  trialDurationDays?: number = 14;
}
