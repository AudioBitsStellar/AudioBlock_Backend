import { SorobanContracts } from '../../config/soroban';
import { SorobanService, addressArg, u64Arg } from '../Soroban/SorobanService';
import { PreparedTransaction } from '../Artist/ArtistService';
import { marketplaceVolumeStroops } from '../MetricsService';

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
    priceInStroops: number,
  ): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      sellerPublicKey,
      SorobanContracts.marketplace,
      'list_nft',
      [addressArg(sellerPublicKey), u64Arg(tokenId), u64Arg(priceInStroops)],
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || '' };
  }

  /**
   * Submits the seller's signed `list_nft` transaction to the Soroban RPC
   * and waits for confirmation.
   *
   * @param signedXdr - The wallet-signed XDR transaction string.
   * @returns Transaction hash.
   * @throws {Error} If Soroban submission fails.
   */
  async submitListing(signedXdr: string): Promise<{ txHash: string }> {
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);
    return { txHash: hash };
  }

  /**
   * Builds the unsigned `buy_nft` invocation for the marketplace contract.
   * The buyer's wallet signs and returns the XDR via `submitBuy` —
   * the backend never holds the buyer's key.
   */
  async prepareBuy(buyerPublicKey: string, tokenId: number): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      buyerPublicKey,
      SorobanContracts.marketplace,
      'buy_nft',
      [addressArg(buyerPublicKey), u64Arg(tokenId)],
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || '' };
  }

  /**
   * Submits the buyer's signed `buy_nft` transaction to the Soroban RPC,
   * waits for confirmation, and optionally increments the marketplace volume metric.
   *
   * @param signedXdr - The wallet-signed XDR transaction string.
   * @param priceStroops - Optional price in stroops to record in metrics.
   * @returns Transaction hash.
   * @throws {Error} If Soroban submission fails.
   */
  async submitBuy(signedXdr: string, priceStroops?: number): Promise<{ txHash: string }> {
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);
    if (priceStroops) {
      marketplaceVolumeStroops.inc(priceStroops);
    }
    return { txHash: hash };
  }
}
