import { IsOptional, IsString, IsNotEmpty } from "class-validator";
import { IsImageFile, MaxFileSize } from "../validators/ImageFile";

export class UpdateArtistProfileDTO {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "Artist name is required." })
  username?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  // @IsString()
  // @MaxFileSize(1 * 1024 * 1024, { message: "Page cover must not exceed 1MB." })
  // @IsImageFile({ message: "Page cover must be a valid image file (jpg or png)." })
  pageCover?: Express.Multer.File | string;

  @IsOptional()
  // @IsString()
  // @MaxFileSize(1 * 1024 * 1024, { message: "Page cover must not exceed 1MB." })
  // @IsImageFile({ message: "Page cover must be a valid image file (jpg or png)." })
  profileImage?: Express.Multer.File | string;

  @IsOptional()
  @IsString()
  website?: string;

}
