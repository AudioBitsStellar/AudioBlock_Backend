import { Repository } from "typeorm";
import { User } from "../../entities/User";
import AppDataSource from "../../config/db";
import { SorobanContracts } from "../../config/soroban";
import { SorobanService, addressArg, stringArg } from "../Soroban/SorobanService";

export interface PreparedTransaction {
  xdr: string;
  networkPassphrase: string;
}

export class ArtistService {
  private userRepo: Repository<User>;
  private soroban: SorobanService;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.soroban = new SorobanService();
  }

  /** Records the Stellar account (e.g. Freighter) the artist will sign on-chain actions with. */
  async connectStellarWallet(userId: string, stellarPublicKey: string): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new Error("User not found");

    user.stellarPublicKey = stellarPublicKey;
    return this.userRepo.save(user);
  }

  /**
   * Builds the unsigned `setup_artist_profile` invocation for the artist
   * contract. The artist's own wallet must sign and return it via
   * `submitArtistOnChainSetup` — the backend never holds the artist's key.
   */
  async prepareArtistOnChainSetup(userId: string, cid: string): Promise<PreparedTransaction> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new Error("User not found");
    if (!user.stellarPublicKey) {
      throw new Error("Connect a Stellar wallet before setting up an on-chain artist profile");
    }
    if (!cid) throw new Error("cid is required");

    const xdrTx = await this.soroban.prepareInvocation(
      user.stellarPublicKey,
      SorobanContracts.artist,
      "setup_artist_profile",
      [addressArg(user.stellarPublicKey), stringArg(cid)]
    );

    return { xdr: xdrTx, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || "" };
  }

  /** Submits the artist's signed `setup_artist_profile` transaction and records the result. */
  async submitArtistOnChainSetup(userId: string, signedXdr: string): Promise<{ txHash: string; artistId: string; tokenId: string }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new Error("User not found");

    const { hash, returnValue } = await this.soroban.submitSignedTransaction(signedXdr);

    // setup_artist_profile returns (artist_id: u64, token_id: u64)
    const [artistId, tokenId] = returnValue as [bigint, bigint];

    user.stellarArtistId = artistId.toString();
    user.stellarArtistTokenId = tokenId.toString();
    await this.userRepo.save(user);

    return { txHash: hash, artistId: user.stellarArtistId, tokenId: user.stellarArtistTokenId };
  }
}
