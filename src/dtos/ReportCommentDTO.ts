import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CommentReportAction,
  CommentReportReason,
} from '../entities/CommentReport';

/** Body for `POST /api/comments/:id/report` (Issue #411). */
export class ReportCommentDTO {
  @IsEnum(CommentReportReason, {
    message: `reason must be one of: ${Object.values(CommentReportReason).join(', ')}`,
  })
  reason!: CommentReportReason;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Description must be 1000 characters or fewer.' })
  description?: string;
}

/** Body for `PUT /api/admin/comment-reports/:id/resolve` (Issue #411). */
export class ResolveCommentReportDTO {
  @IsEnum(CommentReportAction, {
    message: `actionTaken must be one of: ${Object.values(CommentReportAction).join(', ')}`,
  })
  actionTaken!: CommentReportAction;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Resolution note must be 1000 characters or fewer.' })
  resolutionNote?: string;
}
