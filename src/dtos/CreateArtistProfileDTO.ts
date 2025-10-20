import { IsOptional, IsString, IsNotEmpty } from "class-validator";

export class CreateArtistProfileDTO {
  @IsString()
  @IsNotEmpty({ message: "Artist name is required." })
  artist_name!: string;

  @IsString()
  @IsNotEmpty({ message: "Twitter handle is required." })
  twitter_handle!: string;

  @IsString()
  @IsNotEmpty({ message: "DistroKid handle is required." })
  distro_kid!: string;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsString()
  @IsOptional()
  pageCover?: string;

  @IsOptional()
  twitter_verified?: boolean;

  @IsOptional()
  distro_kid_verified?: boolean;
}
