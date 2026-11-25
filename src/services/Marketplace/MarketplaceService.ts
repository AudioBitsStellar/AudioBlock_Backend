import { SorobanContracts, getNetworkPassphrase } from '../../config/soroban';
import logger from '../../config/logger';
import { MarketplaceListing, MarketplaceListingKind } from '../../entities/MarketplaceListing';
import { MarketplaceListingService } from './MarketplaceListingService';
import { MarketplaceIntent, readMarketplaceIntent } from './marketplaceIntent';
import { SorobanService, addressArg, u64Arg } from '../Soroban/SorobanService';
import { PreparedTransaction } from '../Artist/ArtistService';

export class MarketplaceService {
  private soroban: SorobanService;
  private listings: MarketplaceListingService;

  constructor() {
    this.soroban = new SorobanService();
    this.listings = new MarketplaceListingService();
  }

  /**
   * What the wallet actually signed, scoped to the configured marketplace contract.
   *
   * Null whenever the XDR is unreadable or aimed elsewhere. The relay still
   * submits in that case: our own reader must never be the reason a listing stalls.
   */
  private marketplaceIntent(signedXdr: string): MarketplaceIntent | null {
    try {
      return readMarketplaceIntent(signedXdr, {
        networkPassphrase: getNetworkPassphrase(),
        marketplaceContractId: SorobanContracts.marketplace,
      });
    } catch (err) {
      logger.warn({ err }, 'Marketplace intent unavailable; relaying without it');
      return null;
    }
  }

  /**
   * Open the lifecycle row for a listing before submitting it (#920), so a
   * submission that dies between here and the network is still visible to the
   * sweep. Losing the row must not lose the listing, hence best-effort.
   */
  private async recordPendingListing(
    signedXdr: string,
    kind: MarketplaceListingKind,
  ): Promise<MarketplaceListing | null> {
    const intent = this.marketplaceIntent(signedXdr);
    if (!intent || !intent.amountStroops) return null;

    const submittedAt = new Date();
    const durationMs = intent.durationSeconds ? intent.durationSeconds * 1000 : null;
    try {
      return await this.listings.recordPending({
        tokenId: intent.tokenId,
        kind,
        sellerPublicKey: intent.signerAddress,
        priceStroops: intent.amountStroops,
        endsAt: durationMs ? new Date(submittedAt.getTime() + durationMs) : undefined,
      });
    } catch (err) {
      logger.warn({ err, tokenId: intent.tokenId }, 'Could not record pending marketplace listing');
      return null;
    }
  }

  private async markListingActive(listing: MarketplaceListing | null, txHash: string) {
    if (!listing) return;
    try {
      await this.listings.markActive(listing, txHash);
    } catch (err) {
      logger.warn({ err, txHash }, 'Could not mark marketplace listing active');
    }
  }

  private async markListingFailed(listing: MarketplaceListing | null, err: unknown) {
    if (!listing) return;
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await this.listings.markFailed(listing, reason);
    } catch (dbErr) {
      logger.warn({ err: dbErr }, 'Could not mark marketplace listing failed');
    }
  }

  private async markListingSold(tokenId: string | null, txHash: string) {
    if (!tokenId) return;
    try {
      await this.listings.markSoldByToken(tokenId, txHash);
    } catch (err) {
      logger.warn({ err, tokenId }, 'Could not mark marketplace listing sold');
    }
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

  /** Submits the seller's signed `list_nft` transaction and returns the tx hash. */
  async submitListing(signedXdr: string): Promise<{ txHash: string }> {
    const listing = await this.recordPendingListing(signedXdr, 'fixed_price');
    let hash: string;
    try {
      ({ hash } = await this.soroban.submitSignedTransaction(signedXdr));
    } catch (err) {
      await this.markListingFailed(listing, err);
      throw err;
    }
    await this.markListingActive(listing, hash);
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

  /** Submits the buyer's signed `buy_nft` transaction and returns the tx hash. */
  async submitBuy(signedXdr: string): Promise<{ txHash: string }> {
    const intent = this.marketplaceIntent(signedXdr);
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);

    // `active -> sold`: the token this confirmed buy was for leaves the market.
    const tokenId = intent?.functionName === 'buy_nft' ? intent.tokenId : null;
    await this.markListingSold(tokenId, hash);

    // ── Webhook event emission (sale completed) ────────────────────────────
    try {
      const { WebhookService } = await import('../WebhookService');
      const webhook = new WebhookService();
      await webhook.publish('sale.completed', {
        txHash: hash,
        // Read off the signed invocation, so it is the token that actually moved.
        tokenId,
      });
      await webhook.publish('sale_completed', { txHash: hash });
    } catch (webhookErr) {
      // Non-fatal — sale succeeded even if webhook fails
      logger.warn({ err: webhookErr }, 'Webhook publish failed for sale.completed — non-fatal');
    }

    return { txHash: hash };
  }
  async prepareAuction(
    sellerPublicKey: string,
    tokenId: number,
    startingPriceInStroops: number,
    durationSeconds: number,
  ): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      sellerPublicKey,
      SorobanContracts.marketplace,
      'create_auction',
      [
        addressArg(sellerPublicKey),
        u64Arg(tokenId),
        u64Arg(startingPriceInStroops),
        u64Arg(durationSeconds),
      ],
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || '' };
  }

  async submitAuction(signedXdr: string): Promise<{ txHash: string }> {
    const listing = await this.recordPendingListing(signedXdr, 'auction');
    let hash: string;
    try {
      ({ hash } = await this.soroban.submitSignedTransaction(signedXdr));
    } catch (err) {
      await this.markListingFailed(listing, err);
      throw err;
    }
    await this.markListingActive(listing, hash);
    return { txHash: hash };
  }

  async prepareBid(
    bidderPublicKey: string,
    tokenId: number,
    bidAmountInStroops: number,
  ): Promise<PreparedTransaction> {
    const xdr = await this.soroban.prepareInvocation(
      bidderPublicKey,
      SorobanContracts.marketplace,
      'place_bid',
      [addressArg(bidderPublicKey), u64Arg(tokenId), u64Arg(bidAmountInStroops)],
    );
    return { xdr, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || '' };
  }

  async submitBid(signedXdr: string): Promise<{ txHash: string }> {
    const { hash } = await this.soroban.submitSignedTransaction(signedXdr);
    return { txHash: hash };
  }
}
