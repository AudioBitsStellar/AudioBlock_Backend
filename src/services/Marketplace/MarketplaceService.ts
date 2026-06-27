import { SorobanContracts } from "../../config/soroban";
import { SorobanService, addressArg, u64Arg } from "../Soroban/SorobanService";
import { PreparedTransaction } from "../Artist/ArtistService";

export class MarketplaceService {
  private soroban: SorobanService;

  constructor() {
    this.soroban = new SorobanService();
  }

  /**
   * Builds the unsigned `list_nft` invocation for the marketplace contract.
   * The seller's wallet signs and returns the XDR via `submitListing` —
   * the backend never holds the seller's key.
   */
  async prepareListing(
    sellerPublicKey: string,
    tokenId: number,
    priceInStroops: number
  ): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      sellerPublicKey,
      SorobanContracts.marketplace,
      "list_nft",
      [addressArg(sellerPublicKey), u64Arg(tokenId), u64Arg(priceInStroops)]
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || "" };
  }

  /** Submits the seller's signed `list_nft` transaction and returns the tx hash. */
  async submitListing(signedXdr: string): Promise<{ txHash: string }> {
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);
    return { txHash: hash };
  }

  /**
   * Builds the unsigned `buy_nft` invocation for the marketplace contract.
   * The buyer's wallet signs and returns the XDR via `submitBuy` —
   * the backend never holds the buyer's key.
   */
  async prepareBuy(
    buyerPublicKey: string,
    tokenId: number
  ): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      buyerPublicKey,
      SorobanContracts.marketplace,
      "buy_nft",
      [addressArg(buyerPublicKey), u64Arg(tokenId)]
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || "" };
  }

  /** Submits the buyer's signed `buy_nft` transaction and returns the tx hash. */
  async submitBuy(signedXdr: string): Promise<{ txHash: string }> {
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);
    return { txHash: hash };
  }
}
