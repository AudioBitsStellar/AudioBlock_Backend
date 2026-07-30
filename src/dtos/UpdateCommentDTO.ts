import { IsString, Length } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '../entities/Comment';

/**
 * DTO for editing a song comment within the edit window (Issue #90).
 */
export class UpdateCommentDTO {
  @IsString()
  @Length(1, COMMENT_MAX_LENGTH, {
    message: `text must be between 1 and ${COMMENT_MAX_LENGTH} characters`,
  })
  text!: string;
}
