import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '../entities/Comment';

/**
 * DTO for creating a song comment or a reply (Issue #90).
 */
export class CreateCommentDTO {
  @IsString()
  @Length(1, COMMENT_MAX_LENGTH, {
    message: `text must be between 1 and ${COMMENT_MAX_LENGTH} characters`,
  })
  text!: string;

  @IsOptional()
  @IsUUID('4', { message: 'parentId must be a valid UUID' })
  parentId?: string;
}
