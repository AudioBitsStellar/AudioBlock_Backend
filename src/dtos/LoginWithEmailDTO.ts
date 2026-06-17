import { IsEmail, IsString, IsNotEmpty } from "class-validator";

export class LoginWithEmailDTO {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty({ message: "Password is required." })
  password!: string;
}
