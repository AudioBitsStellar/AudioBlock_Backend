import { IsString, IsNotEmpty } from "class-validator";

export class SubmitSignedXdrDTO {
  @IsString()
  @IsNotEmpty({ message: "signedXdr is required." })
  signedXdr!: string;
}
