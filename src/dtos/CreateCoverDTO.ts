import { IsNotEmpty, IsString } from "class-validator";

export class CreateCoverDTO {
  @IsString()
  @IsNotEmpty()
  fileId!: string; // The unique identifier for the song upload session

  // @IsString()
  // @IsNotEmpty()
  // coverPath!: string; // Local path or temporary storage path for the uploaded cover file
}
