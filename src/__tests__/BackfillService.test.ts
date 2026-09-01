import { BackfillService } from '../services/Soroban/BackfillService';
import { SorobanEventReader } from '../services/Soroban/SorobanEventReader';
import { IndexerService } from '../services/IndexerService';
import { IndexedEventService } from '../services/IndexedEventService';

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

function makeIndexerService() {
  return {
    isBackfillCompleted: jest.fn().mockResolvedValue(false),
    getCursor: jest.fn().mockResolvedValue({
      contractId: 'CA_NFT',
      network: 'testnet',
      lastProcessedLedger: 99,
    }),
    recordProgress: jest.fn().mockResolvedValue(undefined),
    updateBackfillProgress: jest.fn().mockResolvedValue(undefined),
    completeBackfill: jest.fn().mockResolvedValue(undefined),
    getBackfillStatus: jest.fn(),
  } as unknown as jest.Mocked<IndexerService>;
}

describe('BackfillService', () => {
  it('refuses to run when the backfill already completed', async () => {
    const indexerService = {
      isBackfillCompleted: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IndexerService>;

    const service = new BackfillService({
      indexerService,
      reader: new SorobanEventReader({} as never),
      eventService: {} as unknown as IndexedEventService,
    });

    await expect(
      service.run({
        contractId: 'CA_NFT',
        contractType: 'nft',
        network: 'testnet',
        startLedger: 100,
        endLedger: 500,
      }),
    ).rejects.toThrow('already completed');
  });

  it('runs a backfill, upserts events and marks completion', async () => {
    const reader = new SorobanEventReader({} as never) as jest.Mocked<SorobanEventReader>;
    reader.fetchAllInRange = jest
      .fn()
      .mockImplementation(
        async (
          _contractIds: string[],
          startLedger: number,
          endLedger: number,
          _limit: number,
          onPage?: (page: unknown, next: number) => Promise<void>,
        ) => {
          for (let l = startLedger; l <= endLedger; l++) {
            await onPage?.(
              {
                events: [
                  {
                    id: `evt-${l}`,
                    ledger: l,
                    txHash: 'tx',
                    topic: [{ symbol: 'mint' }, 'GOWNER'],
                    value: `tok-${l}`,
                    contractId: 'CA_NFT',
                  },
                ],
                cursor: '',
                latestLedger: 1000,
              },
              l + 1,
            );
          }
          return [];
        },
      );

    const indexerService = makeIndexerService();
    const eventService = {
      upsertEvent: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<IndexedEventService>;

    const service = new BackfillService({ indexerService, reader, eventService });

    const result = await service.run({
      contractId: 'CA_NFT',
      contractType: 'nft',
      network: 'testnet',
      startLedger: 100,
      endLedger: 103,
    });

    expect(result.eventsImported).toBe(4);
    expect(eventService.upsertEvent).toHaveBeenCalledTimes(4);
    expect(indexerService.completeBackfill).toHaveBeenCalledWith('CA_NFT', 'testnet');
  });

  it('reports status from backfill and cursor records', async () => {
    const indexerService = {
      getBackfillStatus: jest.fn().mockResolvedValue({
        completed: true,
        startLedger: 100,
        endLedger: 103,
        eventsImported: 4,
        errorMessage: null,
      }),
      getCursor: jest.fn().mockResolvedValue({ lastProcessedLedger: 103 }),
    } as unknown as jest.Mocked<IndexerService>;

    const service = new BackfillService({
      indexerService,
      reader: new SorobanEventReader({} as never),
      eventService: {} as unknown as IndexedEventService,
    });

    const status = await service.status('CA_NFT', 'testnet');
    expect(status).toMatchObject({
      completed: true,
      eventsImported: 4,
      cursorLedger: 103,
    });
  });
});
