import { BatchController } from '../BatchController';
import { createMockRequest, createMockResponse } from '../../../tests/helpers';

// Mock the catalog service so the controller never touches the DB.
const mockBulkGenreUpdate = jest.fn();
const mockToResponseItems = jest.fn();
jest.mock('../services/BatchCatalogService', () => ({
  BatchCatalogService: jest.fn().mockImplementation(() => ({
    bulkGenreUpdate: mockBulkGenreUpdate,
    toResponseItems: mockToResponseItems,
  })),
}));

// Mock the generic dispatcher so sub-requests don't hit the live app.
const mockDispatch = jest.fn();
jest.mock('../services/BatchService', () => ({
  BatchService: jest.fn().mockImplementation(() => ({
    dispatch: mockDispatch,
  })),
}));

function makeRes() {
  const res = createMockResponse();
  return res;
}

describe('BatchController#handle native catalog operations (#434)', () => {
  let controller: BatchController;
  const app = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BatchController(app);
  });

  it('bulkGenreUpdate updates every song and reports per-item results', async () => {
    mockBulkGenreUpdate.mockResolvedValue({
      operation: 'bulkGenreUpdate',
      requested: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { songId: 's1', status: 200, body: { success: true, genre: 'Amapiano' } },
        { songId: 's2', status: 200, body: { success: true, genre: 'Amapiano' } },
      ],
    });
    mockToResponseItems.mockImplementation((results) =>
      results.map((r) => ({ status: r.status, body: r.body })),
    );

    const req = createMockRequest({
      body: [
        { operation: 'bulkGenreUpdate', songIds: ['s1', 's2'], genre: 'Amapiano' },
      ],
    });
    const res = makeRes();

    await controller.handle(req, res);

    expect(mockBulkGenreUpdate).toHaveBeenCalledWith(['s1', 's2'], 'Amapiano');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          status: 200,
          body: {
            operation: 'bulkGenreUpdate',
            requested: 2,
            succeeded: 2,
            failed: 0,
            results: [
              { status: 200, body: { success: true, genre: 'Amapiano' } },
              { status: 200, body: { success: true, genre: 'Amapiano' } },
            ],
          },
        },
      ],
    });
  });

  it('reports partial failure without aborting the batch (one song missing)', async () => {
    mockBulkGenreUpdate.mockResolvedValue({
      operation: 'bulkGenreUpdate',
      requested: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { songId: 's1', status: 200, body: { success: true, genre: 'House' } },
        { songId: 'missing', status: 404, body: { error: { code: 'SONG_NOT_FOUND', message: 'Song missing not found' } } },
      ],
    });
    mockToResponseItems.mockImplementation((results) =>
      results.map((r) => ({ status: r.status, body: r.body })),
    );

    const req = createMockRequest({
      body: [{ operation: 'bulkGenreUpdate', songIds: ['s1', 'missing'], genre: 'House' }],
    });
    const res = makeRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    const [result] = payload.data;
    expect(result.status).toBe(200);
    expect(result.body.failed).toBe(1);
    expect(result.body.results[1].status).toBe(404);
  });

  it('rejects an unsupported operation with 400', async () => {
    const req = createMockRequest({
      body: [{ operation: 'bulkVisibilityToggle' as any, songIds: ['s1'] }],
    });
    const res = makeRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ status: 400, body: { error: { code: 'UNSUPPORTED_OPERATION', message: expect.any(String) } } }],
    });
  });

  it('still dispatches generic { method, path } sub-requests', async () => {
    mockDispatch.mockResolvedValue({ status: 200, body: { ok: true } });

    const req = createMockRequest({ body: [{ method: 'GET', path: '/api/song/s1' }] });
    const res = makeRes();

    await controller.handle(req, res);

    expect(mockDispatch).toHaveBeenCalledWith(
      { method: 'GET', path: '/api/song/s1', body: undefined },
      expect.anything(),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 with empty data for an empty batch', async () => {
    const req = createMockRequest({ body: [] });
    const res = makeRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});
