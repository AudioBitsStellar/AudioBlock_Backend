import { IsOptional, IsString, IsNotEmpty, IsEmail } from "class-validator";

export class SignMessageDTO {
  @IsString()
  @IsNotEmpty({ message: "Wallet Address is required." })
  walletAddress!: string;

  @IsString()
  @IsNotEmpty({ message: "message is required." })
  message!: string;

  @IsEmail()
  @IsNotEmpty({ message: "email is required." })
  email!: string;
}
