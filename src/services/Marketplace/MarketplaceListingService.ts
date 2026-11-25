import { In, LessThanOrEqual } from 'typeorm';
import AppDataSource from '../../config/db';
import { IndexedEvent } from '../../entities/IndexedEvent';
import {
  MARKETPLACE_TERMINAL_STATUSES,
  MarketplaceListing,
  MarketplaceListingKind,
  MarketplaceListingStatus,
} from '../../entities/MarketplaceListing';
import logger from '../../config/logger';

/** How long a relay may sit unconfirmed before the sweep calls it failed (#920). */
export const DEFAULT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000;

/** Terminal rows older than this are deleted by the cleanup step. */
export const DEFAULT_RETENTION_DAYS = 180;

/** Live statuses: the only ones a transition can leave. */
const OPEN_STATUSES: MarketplaceListingStatus[] = ['pending', 'active'];

/** On-chain event types that settle a listing without going through the relay. */
const OBSERVED_EVENT_STATUS: Record<string, MarketplaceListingStatus> = {
  sale: 'sold',
  listing_cancelled: 'cancelled',
  listing_created: 'active',
};

/** Most decisive observation wins when a hash carries more than one event. */
const OBSERVATION_PRECEDENCE: MarketplaceListingStatus[] = ['sold', 'cancelled', 'active'];

export interface LifecycleReport {
  scanned: number;
  confirmed: number;
  sold: number;
  cancelled: number;
  expired: number;
  failed: number;
  pruned: number;
  timestamp: string;
}

export interface SweepOptions {
  /** Injectable clock, so a test can move past an auction end time without waiting. */
  now?: Date;
  confirmationWindowMs?: number;
  retentionDays?: number;
}

export interface NewListingIntent {
  tokenId: string;
  kind: MarketplaceListingKind;
  sellerPublicKey: string;
  priceStroops?: string;
  endsAt?: Date;
}

/**
 * Status store for relayed marketplace listings (#920).
 *
 * Two of the six transitions happen inline while the request is being served
 * (`pending -> active`, `active -> sold`), because the relay waits for the
 * network to confirm. The rest can only be observed later — a cancelled listing
 * is visible in an indexed event, an unbid auction simply ages out — so they
 * belong to the scheduled sweep rather than to any endpoint.
 */
export class MarketplaceListingService {
  private get listings() {
    return AppDataSource.getRepository(MarketplaceListing);
  }

  private get events() {
    return AppDataSource.getRepository(IndexedEvent);
  }

  /** Record a relayed intent before it is submitted, so a lost submission is recoverable. */
  async recordPending(intent: NewListingIntent): Promise<MarketplaceListing> {
    const listing = this.listings.create({
      ...intent,
      status: 'pending' as MarketplaceListingStatus,
    });
    return this.listings.save(listing);
  }

  /** `pending -> active`: the signed transaction was confirmed by the network. */
  async markActive(listing: MarketplaceListing, txHash: string): Promise<MarketplaceListing> {
    listing.status = 'active';
    listing.txHash = txHash;
    listing.confirmedAt = new Date();
    listing.failureReason = undefined;
    return this.listings.save(listing);
  }

  /** `pending -> failed`: submission was rejected, or the relay never got a confirmation. */
  async markFailed(listing: MarketplaceListing, reason: string): Promise<MarketplaceListing> {
    listing.status = 'failed';
    listing.failureReason = reason;
    return this.listings.save(listing);
  }

  /** `active -> sold` for the token a confirmed `buy_nft` just took off the market. */
  async markSoldByToken(tokenId: string, txHash: string): Promise<MarketplaceListing | null> {
    const listing = await this.listings.findOne({
      where: { tokenId, status: In(OPEN_STATUSES) },
    });
    if (!listing) return null;

    listing.status = 'sold';
    listing.txHash = listing.txHash ?? txHash;
    listing.confirmedAt = listing.confirmedAt ?? new Date();
    return this.listings.save(listing);
  }

  /**
   * Move every open listing as far as the available evidence allows, then prune
   * what has been terminal for longer than the retention window.
   */
  async sweep(options: SweepOptions = {}): Promise<LifecycleReport> {
    const now = options.now ?? new Date();
    const windowMs = options.confirmationWindowMs ?? DEFAULT_CONFIRMATION_WINDOW_MS;
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;

    const open = await this.listings.find({
      where: { status: In(OPEN_STATUSES) },
    });

    const report: LifecycleReport = {
      scanned: open.length,
      confirmed: 0,
      sold: 0,
      cancelled: 0,
      expired: 0,
      failed: 0,
      pruned: 0,
      timestamp: now.toISOString(),
    };

    const observed = await this.observeFromEvents(open);
    for (const listing of open) {
      await this.transitionOne(listing, observed.get(listing.txHash ?? ''), windowMs, now, report);
    }

    report.pruned = await this.pruneTerminal(now, retentionDays);
    logger.info({ report }, 'Marketplace listing lifecycle sweep finished');
    return report;
  }

  /** Index on-chain events by tx hash so one query covers every open listing. */
  private async observeFromEvents(
    open: MarketplaceListing[],
  ): Promise<Map<string, IndexedEvent[]>> {
    const hashes = open.map((listing) => listing.txHash).filter((hash): hash is string => !!hash);
    if (hashes.length === 0) return new Map();

    const events = await this.events.find({
      where: { txHash: In(hashes) },
    });

    const byHash = new Map<string, IndexedEvent[]>();
    for (const event of events) {
      if (!event.txHash) continue;
      const list = byHash.get(event.txHash) ?? [];
      list.push(event);
      byHash.set(event.txHash, list);
    }
    return byHash;
  }

  private async transitionOne(
    listing: MarketplaceListing,
    events: IndexedEvent[] | undefined,
    windowMs: number,
    now: Date,
    report: LifecycleReport,
  ): Promise<void> {
    const observed = this.observedStatus(events ?? []);

    if (observed && observed !== listing.status) {
      listing.status = observed;
      await this.listings.save(listing);
      if (observed === 'sold') report.sold += 1;
      else if (observed === 'cancelled') report.cancelled += 1;
      else report.confirmed += 1;
      return;
    }

    if (listing.status === 'active' && this.hasClosed(listing, now)) {
      listing.status = 'expired';
      await this.listings.save(listing);
      report.expired += 1;
      return;
    }

    if (listing.status === 'pending' && this.isAbandoned(listing, windowMs, now)) {
      listing.status = 'failed';
      listing.failureReason = `Unconfirmed ${Math.round(windowMs / 1000)}s after submission`;
      await this.listings.save(listing);
      report.failed += 1;
    }
  }

  /** The single status the indexed events assert about this listing's transaction. */
  private observedStatus(events: IndexedEvent[]): MarketplaceListingStatus | null {
    const seen = new Set(
      events.map((event) => OBSERVED_EVENT_STATUS[event.eventType]).filter(Boolean),
    );
    return OBSERVATION_PRECEDENCE.find((status) => seen.has(status)) ?? null;
  }

  /** Only auctions expire; a fixed-price listing stays open until it sells or is cancelled. */
  private hasClosed(listing: MarketplaceListing, now: Date): boolean {
    return (
      listing.kind === 'auction' && !!listing.endsAt && listing.endsAt.getTime() <= now.getTime()
    );
  }

  private isAbandoned(listing: MarketplaceListing, windowMs: number, now: Date): boolean {
    return now.getTime() - listing.createdAt.getTime() > windowMs;
  }

  /** Cleanup half of #920: terminal rows are history, not state, once they age out. */
  private async pruneTerminal(now: Date, retentionDays: number): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.listings.delete({
      status: In([...MARKETPLACE_TERMINAL_STATUSES]),
      updatedAt: LessThanOrEqual(cutoff),
    });
    return result.affected ?? 0;
  }
}
