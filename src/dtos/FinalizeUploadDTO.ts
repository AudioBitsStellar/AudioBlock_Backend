// src/dtos/CreateUserDto.ts
import { IsOptional, IsString, IsNumber, IsNotEmpty } from 'class-validator';

export class FinalizeUploadDTO {
  @IsString()
  @IsNotEmpty({ message: 'File ID is required.' })
  fileId!: string;

  @IsNumber()
  @IsNotEmpty({ message: 'Total chunks is required.' })
  totalChunks!: number;

  @IsString()
  @IsNotEmpty({ message: 'Song title address is required.' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'Song description is required.' })
  description!: string;

  @IsString()
  @IsNotEmpty({ message: 'Song genre is required.' })
  genre!: string;

  @IsString()
  @IsNotEmpty({ message: 'Cover art path is required.' })
  coverArtPath!: string;

  @IsString()
  @IsOptional()
  composers?: string;
}
