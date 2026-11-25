import { IndexerWorker } from '../workers/indexer/IndexerWorker';
import { SorobanEventReader, EventsPage } from '../services/Soroban/SorobanEventReader';
import { IndexerService } from '../services/IndexerService';
import { IndexedEventService, InsertIndexedEventDTO } from '../services/IndexedEventService';
import { IndexerContract } from '../services/Soroban/IndexerContractRegistry';
import {
  EVENT_DECODERS,
  EVENT_SCHEMA_VERSION,
  UNDECODED_EVENT_TYPE,
} from '../services/Soroban/eventDecoders';

jest.mock('@stellar/stellar-sdk', () => ({
  scValToNative: jest.fn((value: unknown) => value),
  Networks: { TESTNET: 'Test', PUBLIC: 'Public' },
}));

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

jest.mock('../config/soroban', () => ({
  getSorobanServer: jest.fn(),
  getSorobanNetwork: jest.fn(() => 'testnet'),
  getNetworkPassphrase: jest.fn(() => 'Test'),
  getSorobanRpcUrl: jest.fn(() => 'http://rpc'),
}));

const nftContract: IndexerContract = {
  contractType: 'nft',
  contractId: 'CA_NFT',
  decoder: EVENT_DECODERS.nft,
};

function makeReader(results: {
  latest?: number;
  pages?: EventsPage[];
}): jest.Mocked<SorobanEventReader> {
  const reader = new SorobanEventReader({} as never) as jest.Mocked<SorobanEventReader>;
  let idx = 0;
  reader.getLatestLedger = jest.fn().mockResolvedValue(results.latest ?? 500);
  reader.fetchEvents = jest.fn().mockImplementation(async () => {
    const page = results.pages?.[Math.min(idx, (results.pages?.length ?? 1) - 1)];
    if (page) idx += 1;
    return page ?? { events: [], cursor: '', latestLedger: results.latest ?? 500 };
  });
  return reader;
}

function makeIndexerService(overrides: Partial<Record<keyof IndexerService, jest.Mock>> = {}) {
  return {
    getCursor: jest.fn().mockResolvedValue({
      contractId: 'CA_NFT',
      network: 'testnet',
      lastProcessedLedger: 470,
      eventsProcessed: 0,
      errorCount: 0,
      lastError: null,
      lastErrorAt: null,
    }),
    recordProgress: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn().mockResolvedValue(undefined),
    updateLagMetrics: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<IndexerService>;
}

function makeEventService(): jest.Mocked<IndexedEventService> {
  return {
    upsertEvent: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<IndexedEventService>;
}

describe('IndexerWorker', () => {
  it('polls a contract, decodes events and persists progress', async () => {
    const reader = makeReader({
      latest: 500,
      pages: [
        {
          events: [
            {
              id: 'evt-1',
              ledger: 480,
              txHash: 'tx-1',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'mint' }, 'GOWNER'],
              value: 'token-1',
            },
          ],
          cursor: '',
          latestLedger: 500,
        },
      ],
    });

    const indexerService = makeIndexerService();
    const eventService = makeEventService();
    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService,
      reader,
    });

    const outcome = await worker.pollOnce(nftContract);

    expect(outcome.eventsProcessed).toBe(1);
    expect(eventService.upsertEvent).toHaveBeenCalledTimes(1);
    expect(indexerService.recordProgress).toHaveBeenCalled();
  });

  it('records errors and returns an error outcome when RPC is down', async () => {
    const indexerService = makeIndexerService();
    const healthy = makeReader({
      latest: 500,
      pages: [{ events: [], cursor: '', latestLedger: 500 }],
    });
    healthy.getLatestLedger = jest.fn().mockRejectedValue(new Error('RPC down'));

    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService: makeEventService(),
      reader: healthy,
    });

    const outcome = await worker.pollOnce(nftContract);
    expect(outcome.errors).toBeGreaterThanOrEqual(1);
    expect(indexerService.recordError).toHaveBeenCalled();
  });

  it('refreshes lag metrics via updateLagMetrics', async () => {
    const indexerService = makeIndexerService();
    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService: makeEventService(),
      reader: makeReader({ latest: 500 }),
    });

    await worker.updateLagMetrics();
    expect(indexerService.updateLagMetrics).toHaveBeenCalledWith(500);
  });

  it('does not persist a cursor for an empty first poll', async () => {
    const reader = makeReader({
      latest: 500,
      pages: [{ events: [], cursor: '', latestLedger: 500 }],
    });
    const indexerService = makeIndexerService();
    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService: makeEventService(),
      reader,
    });

    const outcome = await worker.pollOnce(nftContract);
    expect(outcome.eventsProcessed).toBe(0);
    expect(indexerService.recordProgress).not.toHaveBeenCalled();
  });

  it('tolerates unknown events: skips them from processing but retains the raw payload', async () => {
    const nullDecoderContract: IndexerContract = {
      ...nftContract,
      decoder: { decode: () => null } as unknown as typeof nftContract.decoder,
    };

    const reader = makeReader({
      latest: 500,
      pages: [
        {
          events: [
            {
              id: 'evt-skip-1',
              ledger: 480,
              txHash: 'tx-skip-1',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'unknown_event' }],
              value: 'raw',
            },
            {
              id: 'evt-skip-2',
              ledger: 481,
              txHash: 'tx-skip-2',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'unknown_event' }],
              value: 'raw',
            },
          ],
          cursor: '',
          latestLedger: 500,
        },
      ],
    });

    const indexerService = makeIndexerService();
    const eventService = makeEventService();
    const worker = new IndexerWorker({
      contracts: [nullDecoderContract],
      indexerService,
      eventService,
      reader,
    });

    const outcome = await worker.pollOnce(nullDecoderContract);
    expect(outcome.eventsSkipped).toBe(2);
    expect(outcome.eventsProcessed).toBe(0);

    // Issue #918: an event this build cannot decode is still written, so its
    // raw topic/value outlives the RPC pruning window.
    expect(eventService.upsertEvent).toHaveBeenCalledTimes(2);
    expect(eventService.upsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contractType: 'nft',
        eventType: UNDECODED_EVENT_TYPE,
        eventId: 'evt-skip-1',
        ledger: 480,
      }),
    );
    const retainedPayload = (
      (eventService.upsertEvent as jest.Mock).mock.calls[0][0] as InsertIndexedEventDTO
    ).payload;
    expect(retainedPayload).toEqual(
      expect.objectContaining({
        schemaVersion: EVENT_SCHEMA_VERSION,
        raw: { topic: [{ symbol: 'unknown_event' }], value: 'raw' },
      }),
    );

    // Retained rows must not be counted as processed domain events.
    expect(indexerService.recordProgress).toHaveBeenCalledWith('CA_NFT', 'testnet', 481, 0);
  });

  it('keeps indexing known events when the same batch holds an unknown one', async () => {
    const reader = makeReader({
      latest: 500,
      pages: [
        {
          events: [
            {
              id: 'evt-known',
              ledger: 480,
              txHash: 'tx-1',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'mint' }, 'GOWNER'],
              value: 'token-1',
            },
            {
              id: 'evt-unknown',
              ledger: 481,
              txHash: 'tx-2',
              contractId: 'CA_NFT',
              // a symbol the nft decoder has no branch for
              topic: [{ symbol: 'sponsored_transfer' }, 'GOWNER'],
              value: 'token-2',
            },
          ],
          cursor: '',
          latestLedger: 500,
        },
      ],
    });

    const indexerService = makeIndexerService();
    const eventService = makeEventService();
    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService,
      reader,
    });

    const outcome = await worker.pollOnce(nftContract);
    expect(outcome.eventsFetched).toBe(2);
    expect(outcome.eventsProcessed).toBe(1);
    expect(outcome.eventsSkipped).toBe(1);
    expect(outcome.errors).toBe(0);
    expect(eventService.upsertEvent).toHaveBeenCalledTimes(2);
    expect(indexerService.recordProgress).toHaveBeenCalledWith('CA_NFT', 'testnet', 481, 1);
  });

  it('reuses the RPC event id for retained events so re-indexing stays idempotent', async () => {
    const nullDecoderContract: IndexerContract = {
      ...nftContract,
      decoder: { decode: () => null } as unknown as typeof nftContract.decoder,
    };

    const page: EventsPage = {
      events: [
        {
          id: 'evt-skip-1',
          ledger: 480,
          txHash: 'tx-skip-1',
          contractId: 'CA_NFT',
          topic: [{ symbol: 'unknown_event' }],
          value: 'raw',
        },
      ],
      cursor: '',
      latestLedger: 500,
    };

    const reader = makeReader({ latest: 500, pages: [page, page] });
    const eventService = makeEventService();
    const worker = new IndexerWorker({
      contracts: [nullDecoderContract],
      indexerService: makeIndexerService(),
      eventService,
      reader,
    });

    await worker.pollOnce(nullDecoderContract);
    await worker.pollOnce(nullDecoderContract);

    const calls = (eventService.upsertEvent as jest.Mock).mock.calls;
    const first = calls[0][0] as InsertIndexedEventDTO;
    const second = calls[1][0] as InsertIndexedEventDTO;
    expect(second.eventId).toBe(first.eventId);
    expect(second.ledger).toBe(first.ledger);
    expect(second.contractId).toBe(first.contractId);
  });

  it('counts a failed retained write as an error without dropping the batch', async () => {
    const nullDecoderContract: IndexerContract = {
      ...nftContract,
      decoder: { decode: () => null } as unknown as typeof nftContract.decoder,
    };

    const reader = makeReader({
      latest: 500,
      pages: [
        {
          events: [
            {
              id: 'evt-skip-1',
              ledger: 480,
              txHash: 'tx-skip-1',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'unknown_event' }],
              value: 'raw',
            },
          ],
          cursor: '',
          latestLedger: 500,
        },
      ],
    });

    const eventService = makeEventService();
    eventService.upsertEvent = jest.fn().mockRejectedValue(new Error('DB write failed'));

    const worker = new IndexerWorker({
      contracts: [nullDecoderContract],
      indexerService: makeIndexerService(),
      eventService,
      reader,
    });

    const outcome = await worker.pollOnce(nullDecoderContract);
    expect(outcome.eventsSkipped).toBe(1);
    expect(outcome.errors).toBe(1);
  });

  it('reports errors separately from skipped events when upsert fails', async () => {
    const indexerService = makeIndexerService();
    const eventService = makeEventService();
    eventService.upsertEvent = jest.fn().mockRejectedValue(new Error('DB write failed'));

    const reader = makeReader({
      latest: 500,
      pages: [
        {
          events: [
            {
              id: 'evt-err-1',
              ledger: 480,
              txHash: 'tx-err-1',
              contractId: 'CA_NFT',
              topic: [{ symbol: 'mint' }, 'GOWNER'],
              value: 'token-1',
            },
          ],
          cursor: '',
          latestLedger: 500,
        },
      ],
    });

    const worker = new IndexerWorker({
      contracts: [nftContract],
      indexerService,
      eventService,
      reader,
    });

    const outcome = await worker.pollOnce(nftContract);
    expect(outcome.errors).toBeGreaterThanOrEqual(1);
    expect(outcome.eventsSkipped).toBe(0);
    expect(outcome.eventsProcessed).toBe(0);
  });
});
