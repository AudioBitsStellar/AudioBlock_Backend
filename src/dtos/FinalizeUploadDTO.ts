import { int } from './../../node_modules/aws-sdk/clients/datapipeline.d';
// src/dtos/CreateUserDto.ts
import { IsEmail, IsEnum, IsOptional, IsString, IsNumber, IsNotEmpty } from "class-validator";
import { Song } from "../entities/Song";

export class FinalizeUploadDTO {

  @IsString()
  @IsNotEmpty({ message: "File ID is required." })
  fileId!: string;

  @IsNumber()
  @IsNotEmpty({ message: "Total chunks is required." })
  totalChunk!: int;

  @IsString()
  @IsNotEmpty({ message: "Song title address is required." })
  title!: string;

}