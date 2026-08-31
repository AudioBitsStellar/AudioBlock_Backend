import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { TakedownReason } from '../entities/TakedownRequest';

export class CreateTakedownRequestDTO {
  @IsString()
  @IsNotEmpty({ message: 'songId is required' })
  songId!: string;

  @IsOptional()
  @IsEnum(TakedownReason, {
    message: `reason must be one of: ${Object.values(TakedownReason).join(', ')}`,
  })
  reason?: TakedownReason;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  evidenceUrl?: string;
}

export class ReviewTakedownRequestDTO {
  @IsString()
  @IsNotEmpty({ message: 'action is required' })
  action!: 'approve' | 'reject' | 'reverse';

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
