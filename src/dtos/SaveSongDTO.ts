import { IsOptional, IsString, Length } from 'class-validator';
import { SAVE_COLLECTION_MAX_LENGTH } from '../entities/UserSave';

/**
 * DTO for saving a song to a user's library (Issue #91).
 * `collection` is optional; omitting it files the save under "Favorites".
 */
export class SaveSongDTO {
  @IsOptional()
  @IsString()
  @Length(1, SAVE_COLLECTION_MAX_LENGTH, {
    message: `collection must be between 1 and ${SAVE_COLLECTION_MAX_LENGTH} characters`,
  })
  collection?: string;
}
