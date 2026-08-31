import { IsUrl, IsOptional, IsArray, IsString } from 'class-validator';

export const ALLOWED_WEBHOOK_EVENTS = [
  'song.minted',
  'sale.completed',
  'mint_status_changed',
  'sale_completed',
  '*',
] as const;

export class CreateWebhookSubscriptionDTO {
  @IsUrl({}, { message: 'endpoint must be a valid URL' })
  endpoint!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypes?: string[];

  @IsOptional()
  @IsString()
  secret?: string;
}
