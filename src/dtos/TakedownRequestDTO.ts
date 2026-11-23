import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { TakedownReason, TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH } from '../entities/TakedownRequest';

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

/** Body for `POST /api/takedown/:id/counter-notice` (#981). */
export class CounterNoticeTakedownDTO {
  @IsString()
  @IsNotEmpty({ message: 'statement is required' })
  @MaxLength(TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH, {
    message: `statement must be at most ${TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH} characters`,
  })
  statement!: string;
}
