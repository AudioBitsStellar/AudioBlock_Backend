import { IsEmail, IsString, IsNotEmpty, IsOptional } from "class-validator";

export class LoginWithEmailDTO {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty({ message: "Password is required." })
  password!: string;

  @IsOptional()
  @IsString()
  twoFactorCode?: string;

  @IsOptional()
  @IsString()
  recoveryCode?: string;
}
