import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for finalizing a song re-upload (Issue #86).
 *
 * Only `fileId` and `totalChunks` are required: metadata fields left out are
 * carried over from the song's current active version.
 */
export class ReuploadSongDTO {
  @IsString()
  @IsNotEmpty({ message: 'File ID is required.' })
  fileId!: string;

  @IsNumber()
  @IsNotEmpty({ message: 'Total chunks is required.' })
  totalChunks!: number;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  genre?: string;

  @IsString()
  @IsOptional()
  coverArtPath?: string;

  @IsString()
  @IsOptional()
  composers?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Change note must be 500 characters or fewer.' })
  changeNote?: string;
}
