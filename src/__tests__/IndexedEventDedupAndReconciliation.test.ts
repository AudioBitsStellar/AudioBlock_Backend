import 'reflect-metadata';
import { IndexedEventService } from '../services/IndexedEventService';
import { ActivityService } from '../services/ActivityService';
import { OnChainReconciliationService } from '../services/OnChainReconciliationService';
import {
  runOnChainReconciliationJob,
  scheduleOnChainReconciliationJob,
  registerOnChainReconciliationHandler,
  ON_CHAIN_RECONCILIATION_JOB_TYPE,
} from '../jobs/OnChainReconciliationJob';
import { IndexedEvent } from '../entities/IndexedEvent';
import { TransactionLog } from '../entities/TransactionLog';
import { JobQueueService } from '../services/JobQueueService';
import AppDataSource from '../config/db';
import * as workerModule from '../workers/JobQueueWorker';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

jest.mock('../services/JobQueueService', () => ({
  JobQueueService: {
    enqueue: jest.fn(),
  },
}));

jest.mock('../workers/JobQueueWorker', () => ({
  registerJobHandler: jest.fn(),
}));

describe('IndexedEvent Deduplication & On-Chain Reconciliation', () => {
  let mockIndexedEventRepo: any;
  let mockTransactionLogRepo: any;
  let indexedEventService: IndexedEventService;
  let activityService: ActivityService;
  let reconciliationService: OnChainReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockIndexedEventRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ id: 'evt-uuid-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };

    mockTransactionLogRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === IndexedEvent || entity?.name === 'IndexedEvent') {
        return mockIndexedEventRepo;
      }
      if (entity === TransactionLog || entity?.name === 'TransactionLog') {
        return mockTransactionLogRepo;
      }
      return {};
    });

    indexedEventService = new IndexedEventService();
    activityService = new ActivityService();
    reconciliationService = new OnChainReconciliationService();
  });

  describe('Idempotency & Deduplication for Indexed Events', () => {
    const sampleEventPayload = {
      network: 'stellar-testnet',
      contractId: 'CA_MARKETPLACE_123',
      contractType: 'marketplace',
      eventType: 'sale',
      eventId: 'evt-001',
      address: 'GBBUYER123',
      txHash: '0xhash123',
      ledger: 45000,
      payload: { price: '100', tokenId: 'tok-1' },
    };

    it('inserts a new indexed event when no duplicate exists', async () => {
      mockIndexedEventRepo.findOne.mockResolvedValue(null);

      const result = await indexedEventService.upsertEvent(sampleEventPayload);

      expect(mockIndexedEventRepo.findOne).toHaveBeenCalledWith({
        where: {
          network: 'stellar-testnet',
          contractId: 'CA_MARKETPLACE_123',
          ledger: 45000,
          eventId: 'evt-001',
        },
      });
      expect(mockIndexedEventRepo.create).toHaveBeenCalled();
      expect(mockIndexedEventRepo.save).toHaveBeenCalled();
      expect(result.eventId).toBe('evt-001');
      expect(result.contractType).toBe('marketplace');
    });

    it('replaying the same event twice is a no-op and does not error', async () => {
      const existingRecord = {
        id: 'existing-uuid-123',
        ...sampleEventPayload,
        createdAt: new Date('2026-08-31T08:00:00Z'),
      };

      // First call simulates finding the existing event
      mockIndexedEventRepo.findOne.mockResolvedValue(existingRecord);

      const result1 = await indexedEventService.upsertEvent(sampleEventPayload);
      const result2 = await indexedEventService.upsertEvent(sampleEventPayload);

      expect(result1).toBe(existingRecord);
      expect(result2).toBe(existingRecord);
      expect(mockIndexedEventRepo.create).not.toHaveBeenCalled();
      expect(mockIndexedEventRepo.save).not.toHaveBeenCalled();
    });

    it('ActivityService.upsertIndexedEvent also deduplicates replayed events', async () => {
      const existingRecord = {
        id: 'existing-uuid-456',
        ...sampleEventPayload,
      };

      mockIndexedEventRepo.findOne.mockResolvedValue(existingRecord);

      const result = await activityService.upsertIndexedEvent(sampleEventPayload);

      expect(result).toBe(existingRecord);
      expect(mockIndexedEventRepo.save).not.toHaveBeenCalled();
    });

    it('handles unique constraint race condition gracefully and returns existing record', async () => {
      // First findOne returns null (simulating concurrent insert race)
      mockIndexedEventRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'race-inserted-id', ...sampleEventPayload });

      const duplicateError: any = new Error('duplicate key value violates unique constraint');
      duplicateError.code = '23505';
      mockIndexedEventRepo.save.mockRejectedValue(duplicateError);

      const result = await indexedEventService.upsertEvent(sampleEventPayload);

      expect(result.id).toBe('race-inserted-id');
    });
  });

  describe('Reconciliation between TransactionLog and IndexedEvent', () => {
    it('flags MISSING_ON_CHAIN when a TransactionLog has txHash but no IndexedEvent exists', async () => {
      const mockLogQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'log-1',
            txHash: '0xmissing_tx',
            action: 'MINT_SONG',
            user_id: 'user-1',
            description: 'Submitted song mint',
            createdAt: new Date(),
          },
        ]),
      };

      const mockEventQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockTransactionLogRepo.createQueryBuilder.mockReturnValue(mockLogQb);
      mockIndexedEventRepo.createQueryBuilder.mockReturnValue(mockEventQb);

      const report = await reconciliationService.reconcile(24);

      expect(report.scannedLogs).toBe(1);
      expect(report.scannedEvents).toBe(0);
      expect(report.matched).toBe(0);
      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({
        type: 'MISSING_ON_CHAIN',
        txHash: '0xmissing_tx',
        transactionLogId: 'log-1',
      });
    });

    it('flags STATUS_MISMATCH when TransactionLog recorded failure/timeout but on-chain event landed', async () => {
      const mockLogQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'log-2',
            txHash: '0xtimeout_tx',
            action: 'TRANSACTION_TIMED_OUT',
            user_id: 'user-2',
            description: 'Soroban submit timed out waiting for confirmation',
            createdAt: new Date(),
          },
        ]),
      };

      const mockEventQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-landed-1',
            txHash: '0xtimeout_tx',
            eventType: 'song_minted',
            createdAt: new Date(),
          },
        ]),
      };

      mockTransactionLogRepo.createQueryBuilder.mockReturnValue(mockLogQb);
      mockIndexedEventRepo.createQueryBuilder.mockReturnValue(mockEventQb);

      const report = await reconciliationService.reconcile(24);

      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({
        type: 'STATUS_MISMATCH',
        txHash: '0xtimeout_tx',
        transactionLogId: 'log-2',
        indexedEventId: 'evt-landed-1',
      });
    });

    it('flags UNTRACKED_ON_CHAIN when IndexedEvent exists without corresponding backend TransactionLog', async () => {
      const mockLogQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      const mockEventQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-untracked-1',
            txHash: '0xdirect_wallet_tx',
            eventType: 'nft_transfer',
            contractType: 'nft',
            address: 'GBEXTERNAL',
            createdAt: new Date(),
          },
        ]),
      };

      mockTransactionLogRepo.createQueryBuilder.mockReturnValue(mockLogQb);
      mockIndexedEventRepo.createQueryBuilder.mockReturnValue(mockEventQb);

      const report = await reconciliationService.reconcile(24);

      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({
        type: 'UNTRACKED_ON_CHAIN',
        txHash: '0xdirect_wallet_tx',
        indexedEventId: 'evt-untracked-1',
      });
    });

    it('reports 0 mismatches when TransactionLog and IndexedEvent match cleanly', async () => {
      const mockLogQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'log-3',
            txHash: '0xmatched_tx',
            action: 'MINT_SONG',
            description: 'Song minted successfully',
            createdAt: new Date(),
          },
        ]),
      };

      const mockEventQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-matched-1',
            txHash: '0xmatched_tx',
            eventType: 'song_minted',
            createdAt: new Date(),
          },
        ]),
      };

      mockTransactionLogRepo.createQueryBuilder.mockReturnValue(mockLogQb);
      mockIndexedEventRepo.createQueryBuilder.mockReturnValue(mockEventQb);

      const report = await reconciliationService.reconcile(24);

      expect(report.matched).toBe(1);
      expect(report.mismatches).toHaveLength(0);
    });
  });

  describe('Scheduled Job & Worker Integration', () => {
    it('schedules on-chain reconciliation job via JobQueueService', async () => {
      await scheduleOnChainReconciliationJob(48);

      expect(JobQueueService.enqueue).toHaveBeenCalledWith(
        ON_CHAIN_RECONCILIATION_JOB_TYPE,
        { lookbackHours: 48 },
        { priority: 'low' },
      );
    });

    it('runs runOnChainReconciliationJob helper correctly', async () => {
      const mockLogQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const mockEventQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTransactionLogRepo.createQueryBuilder.mockReturnValue(mockLogQb);
      mockIndexedEventRepo.createQueryBuilder.mockReturnValue(mockEventQb);

      const report = await runOnChainReconciliationJob(12);

      expect(report.scannedLogs).toBe(0);
      expect(report.scannedEvents).toBe(0);
      expect(report.mismatches).toHaveLength(0);
    });

    it('registers on-chain reconciliation handler with JobQueueWorker', async () => {
      registerOnChainReconciliationHandler();

      expect(workerModule.registerJobHandler).toHaveBeenCalledWith(
        ON_CHAIN_RECONCILIATION_JOB_TYPE,
        expect.any(Function),
      );
    });
  });
});
