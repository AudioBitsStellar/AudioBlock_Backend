import { IsString, IsNotEmpty, Matches } from "class-validator";

/**
 * Data Transfer Object for connecting a Stellar wallet to an artist account.
 *
 * Current Flow (as of 2026-06-26):
 * 1. Artist dashboard calls Freighter's getPublicKey()
 * 2. Dashboard sends stellarPublicKey to POST /api/artist/onchain/connect-wallet
 * 3. Backend records the public key without signature verification
 *
 * Future Enhancement:
 * A signed challenge may be added for verification that the user
 * controls the wallet, but is not currently required.
 *
 * See docs/ON_CHAIN_INTEGRATION.md for frontend integration examples.
 */
export class ConnectStellarWalletDTO {
  @IsString()
  @IsNotEmpty({ message: "stellarPublicKey is required." })
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: "stellarPublicKey must be a valid Stellar G... address.",
  })
  stellarPublicKey!: string;
}
