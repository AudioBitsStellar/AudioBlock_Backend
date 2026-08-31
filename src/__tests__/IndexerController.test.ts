import { AdminController } from '../controllers/AdminController';
import { createMockRequest, createMockResponse } from '../utils/testHelpers';

// Mock IndexerService
const mockGetAllStatus = jest.fn();
const mockGetAllBackfillStatus = jest.fn();

jest.mock('../services/IndexerService', () => ({
errorCount: 0,
        lastError: null,
        lastErrorAt: null,
        lagLedgers: 10,
        updatedAt: new Date('2026-08-31T10:00:00Z'),
      },
      {
        contractId: 'CBBB...SONG',
        network: 'mainnet',
        lastProcessedLedger: 950,
        eventsProcessed: 320,
        errorCount: 2,
        lastError: 'RPC timeout',
        lastErrorAt: new Date('2026-08-31T09:45:00Z'),
        lagLedgers: 60,
        updatedAt: new Date('2026-08-31T09:50:00Z'),
      },
    ];

    const mockBackfills = [
      {
        contractId: 'CAAA...ARTIST',
        network: 'mainnet',
        completed: true,
        startLedger: 1,
        endLedger: 500,
        eventsImported: 250,
        errorMessage: null,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T12:00:00Z'),
      },
    ];

    mockGetAllStatus.mockResolvedValue(mockIndexers);
    mockGetAllBackfillStatus.mockResolvedValue(mockBackfills);

    const req = createMockRequest({ query: { currentLedger: '1010' } });
    const res = createMockResponse();

    await AdminController.getIndexerStatus(req, res as any);

    expect(mockGetAllStatus).toHaveBeenCalledWith(1010);
    expect(mockGetAllBackfillStatus).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      indexers: mockIndexers,
      backfills: mockBackfills,
    });
  });

  it('returns status without currentLedger parameter', async () => {
    mockGetAllStatus.mockResolvedValue([]);
    mockGetAllBackfillStatus.mockResolvedValue([]);

    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await AdminController.getIndexerStatus(req, res as any);

    expect(mockGetAllStatus).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('handles errors gracefully', async () => {
    mockGetAllStatus.mockRejectedValue(new Error('Database connection failed'));

    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await AdminController.getIndexerStatus(req, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Database connection failed'),
      }),
    );
  });
});
