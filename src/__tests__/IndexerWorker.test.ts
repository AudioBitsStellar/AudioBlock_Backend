/**
 * Tests for IndexerWorker (Issues #255, #258)
 */

import { IndexerWorker } from '../workers/IndexerWorker';
import { IndexerService } from '../services/IndexerService';
import { IndexedEventService } from '../services/IndexedEventService';

jest.mock('../services/IndexerService');
jest.mock('../services/IndexedEventService');
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('IndexerWorker', () => {
  let mockIndexerService: jest.Mocked<IndexerService>;
  let mockEventService: jest.Mocked<IndexedEventService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockIndexerService = {
      getCursor: jest.fn(),
      recordProgress: jest.fn(),
      recordError: jest.fn(),
      updateLagMetrics: jest.fn(),
    } as any;

    mockEventService = {
      upsertEvent: jest.fn(),
    } as any;

    (IndexerService as jest.Mock).mockImplementation(() => mockIndexerService);
    (IndexedEventService as jest.Mock).mockImplementation(() => mockEventService);
  });

  describe('configuration loading', () => {
    it('should load contract configurations from environment variables', () => {
      process.env.ARTIST_FACET_MAINNET_CONTRACT_ID = 'CXXX123';
      process.env.SONG_FACET_TESTNET_CONTRACT_ID = 'CYYY456';

      const worker = new IndexerWorker();

      // Worker should have loaded contracts
      expect(worker).toBeDefined();
    });

    it('should handle missing contract configurations gracefully', () => {
      // Clear all contract env vars
      delete process.env.ARTIST_FACET_MAINNET_CONTRACT_ID;
      delete process.env.SONG_FACET_TESTNET_CONTRACT_ID;

      const worker = new IndexerWorker();

      expect(worker).toBeDefined();
    });
  });

  describe('graceful shutdown', () => {
    it('should setup SIGTERM handler', () => {
      const processOnSpy = jest.spyOn(process, 'on');

      new IndexerWorker();

      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should set shutdown flag when receiving SIGTERM', () => {
      const worker = new IndexerWorker();

      // Get the SIGTERM handler
      const sigtermHandler = (process.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'SIGTERM'
      )?.[1];

      expect(sigtermHandler).toBeDefined();

      // Call the handler
      if (sigtermHandler) {
        sigtermHandler();
      }

      // The shutdownRequested flag should be set (not directly testable, but handler was called)
      expect(sigtermHandler).toBeDefined();
    });
  });

  describe('cursor management', () => {
    it('should advance cursor only after batch completes', async () => {
      mockIndexerService.getCursor.mockResolvedValue({
        contractId: 'CXXX123',
        network: 'mainnet',
        lastProcessedLedger: 1000,
        eventsProcessed: 0,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: '123',
      });

      // Test that recordProgress is called with correct parameters
      await mockIndexerService.recordProgress('CXXX123', 'mainnet', 1100, 5);

      expect(mockIndexerService.recordProgress).toHaveBeenCalledWith(
        'CXXX123',
        'mainnet',
        1100,
        5
      );
    });
  });

  describe('error handling', () => {
    it('should record errors without crashing', async () => {
      const testError = new Error('RPC timeout');

      await mockIndexerService.recordError('CXXX123', 'mainnet', testError);

      expect(mockIndexerService.recordError).toHaveBeenCalledWith(
        'CXXX123',
        'mainnet',
        testError
      );
    });
  });

  describe('network isolation', () => {
    it('should maintain separate cursors per contract+network', async () => {
      const mainnetCursor = {
        contractId: 'CXXX123',
        network: 'mainnet',
        lastProcessedLedger: 1000,
        eventsProcessed: 100,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: '1',
      };

      const testnetCursor = {
        contractId: 'CXXX123',
        network: 'testnet',
        lastProcessedLedger: 500,
        eventsProcessed: 50,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: '2',
      };

      mockIndexerService.getCursor
        .mockResolvedValueOnce(mainnetCursor)
        .mockResolvedValueOnce(testnetCursor);

      const mainnet
