import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsString } from 'class-validator';
import {
  BulkModerationAction,
  BULK_MODERATION_MAX_BATCH,
} from '../services/Song/SongModerationService';

/** Body for `POST /api/admin/songs/moderate` (Issue #85). */
export class BulkModerateSongsDTO {
  @IsArray()
  @ArrayMinSize(1, { message: 'songIds must contain at least one song ID.' })
  @ArrayMaxSize(BULK_MODERATION_MAX_BATCH, {
    message: `songIds must contain at most ${BULK_MODERATION_MAX_BATCH} song IDs.`,
  })
  @IsString({ each: true, message: 'Each song ID must be a string.' })
  songIds!: string[];

  @IsEnum(BulkModerationAction, {
    message: `action must be one of: ${Object.values(BulkModerationAction).join(', ')}`,
  })
  action!: BulkModerationAction;
}
