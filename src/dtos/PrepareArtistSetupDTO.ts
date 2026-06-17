import { IsString, IsNotEmpty } from "class-validator";

export class PrepareArtistSetupDTO {
  @IsString()
  @IsNotEmpty({ message: "cid is required." })
  cid!: string;
}
