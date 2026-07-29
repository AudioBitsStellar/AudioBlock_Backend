import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportAction, ReportReason } from '../entities/ContentReport';

/** Body for `POST /api/song/:id/report` (Issue #88). */
export class ReportSongDTO {
  @IsEnum(ReportReason, {
    message: `reason must be one of: ${Object.values(ReportReason).join(', ')}`,
  })
  reason!: ReportReason;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Description must be 1000 characters or fewer.' })
  description?: string;
}

/** Body for `PUT /api/admin/reports/:id/resolve` (Issue #88). */
export class ResolveReportDTO {
  @IsEnum(ReportAction, {
    message: `actionTaken must be one of: ${Object.values(ReportAction).join(', ')}`,
  })
  actionTaken!: ReportAction;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Resolution note must be 1000 characters or fewer.' })
  resolutionNote?: string;
}
