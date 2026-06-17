import { IsString, IsNotEmpty, Matches } from "class-validator";

export class ConnectStellarWalletDTO {
  @IsString()
  @IsNotEmpty({ message: "stellarPublicKey is required." })
  @Matches(/^G[A-Z2-7]{55}$/, { message: "stellarPublicKey must be a valid Stellar G... address." })
  stellarPublicKey!: string;
}
