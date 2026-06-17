import { IsEmail, IsEnum, IsOptional, IsString, MinLength, IsNotEmpty } from "class-validator";
import { UserRole } from "../entities/User";

export class RegisterWithEmailDTO {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters." })
  password!: string;

  @IsEnum(UserRole)
  @IsNotEmpty({ message: "Role is required." })
  role!: UserRole;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
