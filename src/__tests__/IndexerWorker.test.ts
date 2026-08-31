import { IndexerWorker } from '../workers/indexer/IndexerWorker';
import { SorobanEventReader, EventsPage } from '../services/Soroban/SorobanEventReader';
import { IndexerService } from '../services/IndexerService';
import { IndexedEventService } from '../services/IndexedEventService';
import { IndexerContract } from '../services/Soroban/IndexerContractRegistry';
import { EVENT_DECODERS } from '../services/Soroban/eventDecoders';

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
});
