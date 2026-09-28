/**
 * Unit tests for SorobanIndexingService (Issue #658).
 */

import { SorobanIndexingService } from '../../services/Soroban/SorobanIndexingService';

// ---- mocks ----
const mockFetchEvents = jest.fn();
const mockGetCursor = jest.fn();
const mockAdvanceCursor = jest.fn();
const mockRecordError = jest.fn();
const mockInsertBatch = jest.fn();

const mockReader = { fetchEvents: mockFetchEvents } as any;
const mockIndexerService = {
  getCursor: mockGetCursor,
  advanceCursor: mockAdvanceCursor,
  recordError: mockRecordError,
} as any;
const mockEventService = { insertBatch: mockInsertBatch } as any;

// Silence logger in tests
jest.mock('../../config/logger', () => ({
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Silence metrics in tests
jest.mock('../../services/MetricsService', () => ({
  indexerLagLedgers: { set: jest.fn() },
  indexerEventsProcessedTotal: { inc: jest.fn() },
  indexerErrorsTotal: { inc: jest.fn() },
}));

// Stub the contract registry so tests run without real env vars
jest.mock('../../services/Soroban/IndexerContractRegistry', () => ({
  buildIndexerContracts: () => [
    {
      contractType: 'catalog',
      contractId: 'CSONG_TEST',
      decoder: {
        contractType: 'catalog',
        decode: (event: any) => ({
          contractId: event.contractId,
          contractType: 'catalog',
          eventType: 'song_registered',
          eventId: event.id,
          txHash: event.txHash,
          ledger: event.ledger,
          payload: { songId: event.topic[1] ?? null },
        }),
      },
    },
  ],
}));

describe('SorobanIndexingService (Issue #658)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCursor.mockResolvedValue({ lastProcessedLedger: 100 });
    mockAdvanceCursor.mockResolvedValue(undefined);
    mockInsertBatch.mockResolvedValue(undefined);
    mockRecordError.mockResolvedValue(undefined);
  });

  it('persists decoded events and advances cursor', async () => {
    mockFetchEvents.mockResolvedValue({
      events: [
        { id: 'e1', ledger: 101, txHash: '0xtx1', contractId: 'CSONG_TEST', topic: ['song_registered', 'song-42'], value: null },
        { id: 'e2', ledger: 105, txHash: '0xtx2', contractId: 'CSONG_TEST', topic: ['song_registered', 'song-43'], value: null },
      ],
      cursor: '',
      latestLedger: 110,
    });

    const service = new SorobanIndexingService(mockReader, mockIndexerService, mockEventService, {
      networks: ['testnet'],
    });
    const count = await service.processNextBatch();

    expect(count).toBe(2);
    expect(mockInsertBatch).toHaveBeenCalledTimes(1);
    const rows = mockInsertBatch.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0].eventType).toBe('song_registered');

    // Cursor should advance to the highest ledger seen (105)
    expect(mockAdvanceCursor).toHaveBeenCalledWith('CSONG_TEST', 'testnet', 105);
  });

  it('does nothing and does not advance cursor when there are no events', async () => {
    mockFetchEvents.mockResolvedValue({ events: [], cursor: '', latestLedger: 100 });

    const service = new SorobanIndexingService(mockReader, mockIndexerService, mockEventService, {
      networks: ['testnet'],
    });
    const count = await service.processNextBatch();

    expect(count).toBe(0);
    expect(mockInsertBatch).not.toHaveBeenCalled();
    expect(mockAdvanceCursor).not.toHaveBeenCalled();
  });

  it('records error and continues when RPC fetch throws', async () => {
    mockFetchEvents.mockRejectedValue(new Error('RPC timeout'));

    const service = new SorobanIndexingService(mockReader, mockIndexerService, mockEventService, {
      networks: ['testnet'],
    });
    // Should not throw even if RPC fails
    await expect(service.processNextBatch()).resolves.toBe(0);

    expect(mockRecordError).toHaveBeenCalledWith('CSONG_TEST', 'testnet', 'RPC timeout');
    expect(mockInsertBatch).not.toHaveBeenCalled();
  });
});
