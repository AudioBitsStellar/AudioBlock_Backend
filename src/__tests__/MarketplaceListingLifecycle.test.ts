/**
 * Status transitions for relayed marketplace listings (#920).
 *
 * The relay is sign-locally, so a listing can die in four different places:
 * the wallet never signs, the network rejects the submission, the seller
 * cancels on-chain, or an auction simply runs out of time. Only the first two
 * are visible while a request is being served; the rest are what the scheduled
 * sweep exists for, so they are exercised here against the store directly.
 */

import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn(), isInitialized: true },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import AppDataSource from '../config/db';
import { IndexedEvent } from '../entities/IndexedEvent';
import { MarketplaceListing } from '../entities/MarketplaceListing';
import { MarketplaceListingService } from '../services/Marketplace/MarketplaceListingService';
import { runMarketplaceListingLifecycleJob } from '../jobs/MarketplaceListingLifecycleJob';

const dataSource = AppDataSource as unknown as { getRepository: jest.Mock };

const NOW = new Date('2026-03-01T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function aListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: 'listing-1',
    tokenId: '7',
    kind: 'fixed_price',
    sellerPublicKey: 'GSELLER',
    priceStroops: '10000000',
    status: 'active',
    txHash: 'HASH-1',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...overrides,
  } as MarketplaceListing;
}

function anEvent(eventType: string, txHash = 'HASH-1'): IndexedEvent {
  return { eventType, txHash } as IndexedEvent;
}

let openListings: MarketplaceListing[];
let observedEvents: IndexedEvent[];
let saved: MarketplaceListing[];
let deletedCount: number;
let listingRepo: {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};
let eventRepo: { find: jest.Mock };
let service: MarketplaceListingService;

beforeEach(() => {
  jest.clearAllMocks();
  openListings = [];
  observedEvents = [];
  saved = [];
  deletedCount = 0;

  listingRepo = {
    find: jest.fn(async () => openListings),
    findOne: jest.fn(async () => null),
    create: jest.fn((attrs: Record<string, unknown>) => ({ id: 'row-1', ...attrs })),
    save: jest.fn(async (listing: MarketplaceListing) => {
      saved.push(listing);
      return listing;
    }),
    delete: jest.fn(async () => ({ affected: deletedCount })),
  };
  eventRepo = { find: jest.fn(async () => observedEvents) };

  dataSource.getRepository.mockImplementation((entity: unknown) => {
    if (entity === MarketplaceListing) return listingRepo;
    if (entity === IndexedEvent) return eventRepo;
    throw new Error(`Unexpected repository requested: ${String(entity)}`);
  });

  service = new MarketplaceListingService();
});

const sweep = (options = {}) => service.sweep({ now: NOW, ...options });

describe('recording a relay', () => {
  it('opens a pending row from the decoded intent', async () => {
    const row = await service.recordPending({
      tokenId: '7',
      kind: 'fixed_price',
      sellerPublicKey: 'GSELLER',
      priceStroops: '10000000',
    });

    expect(listingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: '7', status: 'pending' }),
    );
    expect(row.status).toBe('pending');
    expect(saved).toHaveLength(1);
  });

  it('pending -> active once the network confirms the submission', async () => {
    const row = aListing({ status: 'pending', txHash: undefined });
    await service.markActive(row, 'HASH-1');

    expect(row.status).toBe('active');
    expect(row.txHash).toBe('HASH-1');
    expect(row.confirmedAt).toBeInstanceOf(Date);
    expect(saved).toContain(row);
  });

  it('pending -> failed when the submission is rejected, keeping the reason', async () => {
    const row = aListing({ status: 'pending' });
    await service.markFailed(row, 'Soroban transaction rejected: {"errorResultXdr":"..."}');

    expect(row.status).toBe('failed');
    expect(row.failureReason).toContain('Soroban transaction rejected');
    expect(saved).toContain(row);
  });

  it('active -> sold for the token a confirmed buy named', async () => {
    const row = aListing({ status: 'active' });
    listingRepo.findOne.mockResolvedValueOnce(row);

    const sold = await service.markSoldByToken('7', 'HASH-BUY');

    expect(sold?.status).toBe('sold');
    // the listing keeps the hash that put it on the market
    expect(sold?.txHash).toBe('HASH-1');
  });

  it('ignores a sale for a token it never relayed', async () => {
    expect(await service.markSoldByToken('99', 'HASH-BUY')).toBeNull();
    expect(listingRepo.save).not.toHaveBeenCalled();
  });
});

describe('sweep: expiry', () => {
  it('expires an auction whose end time has passed with no bid', async () => {
    const auction = aListing({ kind: 'auction', status: 'active', endsAt: daysAgo(1) });
    openListings = [auction];

    const report = await sweep();

    expect(auction.status).toBe('expired');
    expect(report.expired).toBe(1);
    expect(report.scanned).toBe(1);
  });

  it('never expires a fixed-price listing, which has no end time', async () => {
    const fixed = aListing({ kind: 'fixed_price', status: 'active', endsAt: daysAgo(1) });
    openListings = [fixed];

    const report = await sweep();

    expect(fixed.status).toBe('active');
    expect(report.expired).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('keeps an auction that still has time left', async () => {
    const auction = aListing({ kind: 'auction', status: 'active', endsAt: minutesAgo(-30) });
    openListings = [auction];

    expect((await sweep()).expired).toBe(0);
    expect(auction.status).toBe('active');
  });
});

describe('sweep: failure', () => {
  it('fails a relay the network never confirmed', async () => {
    const stale = aListing({ status: 'pending', txHash: undefined, createdAt: minutesAgo(16) });
    openListings = [stale];

    const report = await sweep({ confirmationWindowMs: 15 * 60_000 });

    expect(stale.status).toBe('failed');
    expect(stale.failureReason).toBe('Unconfirmed 900s after submission');
    expect(report.failed).toBe(1);
  });

  it('leaves a relay still inside the confirmation window', async () => {
    const recent = aListing({ status: 'pending', createdAt: minutesAgo(2) });
    openListings = [recent];

    const report = await sweep({ confirmationWindowMs: 15 * 60_000 });

    expect(recent.status).toBe('pending');
    expect(report.failed).toBe(0);
  });

  it('reads only open rows, so terminal listings are never revisited', async () => {
    openListings = [];

    await sweep();

    const call = listingRepo.find.mock.calls[0][0] as { where: { status: { value: unknown } } };
    expect(call.where.status.value).toEqual(['pending', 'active']);
  });
});

describe('sweep: on-chain observations', () => {
  it('cancels a listing the seller cancelled directly on-chain', async () => {
    openListings = [aListing()];
    observedEvents = [anEvent('listing_cancelled')];

    const report = await sweep();

    expect(openListings[0].status).toBe('cancelled');
    expect(report.cancelled).toBe(1);
  });

  it('sells a listing settled by a sale event', async () => {
    openListings = [aListing()];
    observedEvents = [anEvent('sale')];

    expect((await sweep()).sold).toBe(1);
    expect(openListings[0].status).toBe('sold');
  });

  it('confirms a pending relay whose listing_created event landed', async () => {
    openListings = [aListing({ status: 'pending' })];
    observedEvents = [anEvent('listing_created')];

    const report = await sweep();

    expect(report.confirmed).toBe(1);
    expect(openListings[0].status).toBe('active');
  });

  it('takes the most decisive event when one transaction carries several', async () => {
    openListings = [aListing()];
    observedEvents = [anEvent('listing_cancelled'), anEvent('sale')];

    const report = await sweep();

    expect(openListings[0].status).toBe('sold');
    expect(report.sold).toBe(1);
    expect(report.cancelled).toBe(0);
  });

  it('leaves a listing untouched for events it does not understand', async () => {
    openListings = [aListing({ kind: 'auction', endsAt: daysAgo(-30) })];
    observedEvents = [anEvent('royalty_paid')];

    const report = await sweep();

    expect(openListings[0].status).toBe('active');
    expect(report).toMatchObject({ confirmed: 0, sold: 0, cancelled: 0, expired: 0, failed: 0 });
  });

  it('does not query events when nothing is open', async () => {
    openListings = [];

    expect((await sweep()).scanned).toBe(0);
    expect(eventRepo.find).not.toHaveBeenCalled();
  });
});

describe('sweep: cleanup', () => {
  it('deletes terminal rows older than the retention window', async () => {
    deletedCount = 4;
    const { pruned } = await sweep({ retentionDays: 180 });

    expect(pruned).toBe(4);
    const where = listingRepo.delete.mock.calls[0][0] as Record<string, { value: unknown }>;
    expect(where.status.value).toEqual(['sold', 'cancelled', 'expired', 'failed']);
    expect((where.updatedAt.value as Date).toISOString()).toBe(daysAgo(180).toISOString());
  });

  it('never deletes an open listing', async () => {
    openListings = [aListing({ status: 'active' })];
    deletedCount = 0;

    await sweep();

    const where = listingRepo.delete.mock.calls[0][0] as Record<string, { value: unknown }>;
    expect(where.status.value).not.toContain('active');
    expect(where.status.value).not.toContain('pending');
  });
});

describe('the scheduled job', () => {
  it('returns the sweep report for the scheduler to log', async () => {
    openListings = [
      aListing({ kind: 'auction', status: 'active', endsAt: daysAgo(2), txHash: 'HASH-A' }),
      aListing({ id: 'listing-2', status: 'pending', txHash: undefined, createdAt: daysAgo(1) }),
    ];
    deletedCount = 1;

    const report = await runMarketplaceListingLifecycleJob({
      now: NOW,
      confirmationWindowMs: 60_000,
    });

    expect(report).toMatchObject({ scanned: 2, expired: 1, failed: 1, pruned: 1 });
    expect(report.timestamp).toBe(NOW.toISOString());
  });

  it('is a no-op against an empty store', async () => {
    const report = await runMarketplaceListingLifecycleJob({ now: NOW });
    expect(report.scanned).toBe(0);
    expect(report.pruned).toBe(0);
  });
});
