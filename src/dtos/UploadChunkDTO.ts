import { Type } from "class-transformer";
import { IsNotEmpty, IsNumber, IsString, Min } from "class-validator";

export class UploadChunkDTO {
  @IsString()
  @IsNotEmpty()
  fileId!: string; // unique identifier for upload session

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  chunkIndex!: number; // index of this specific chunk (0-based)
}
