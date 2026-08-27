import 'reflect-metadata';

const mockCreate = jest.fn();
const mockFindPaginated = jest.fn();
const mockGetById = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../services/ReleaseService', () => ({
  ReleaseService: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    findPaginated: mockFindPaginated,
    getById: mockGetById,
    update: mockUpdate,
  })),
}));

import { ReleaseController } from '../controllers/ReleaseController';
import { Request, Response } from 'express';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as unknown as Request;
}

function mockRes(): { res: Response; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { json, status } as unknown as Response, json, status };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockFindPaginated.mockReset();
  mockGetById.mockReset();
  mockUpdate.mockReset();
});

describe('ReleaseController.create — publish flow (issue #316)', () => {
  it('rejects a request missing required fields (title/releaseDate/type)', async () => {
    const req = mockReq({ user: { id: 'artist1' }, body: { title: 'My Album' } });
    const { res, status } = mockRes();

    await ReleaseController.create(req, res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('creates a release scheduled for a future date', async () => {
    const futureDate = '2027-01-01T00:00:00.000Z';
    mockCreate.mockResolvedValue({
      id: 'r1',
      title: 'My Album',
      releaseDate: futureDate,
      type: 'album',
    });
    const req = mockReq({
      user: { id: 'artist1' },
      body: { title: 'My Album', releaseDate: futureDate, type: 'album', songIds: ['s1', 's2'] },
    });
    const { res, status, json } = mockRes();

    await ReleaseController.create(req, res);

    expect(mockCreate).toHaveBeenCalledWith({
      title: 'My Album',
      artistId: 'artist1',
      releaseDate: futureDate,
      type: 'album',
      coverArt: undefined,
      songIds: ['s1', 's2'],
    });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ id: 'r1' }) }),
    );
  });

  it('creates a release with an immediate (past/now) release date', async () => {
    const pastDate = '2020-01-01T00:00:00.000Z';
    mockCreate.mockResolvedValue({
      id: 'r2',
      title: 'Old Single',
      releaseDate: pastDate,
      type: 'single',
    });
    const req = mockReq({
      user: { id: 'artist1' },
      body: { title: 'Old Single', releaseDate: pastDate, type: 'single' },
    });
    const { res, status } = mockRes();

    await ReleaseController.create(req, res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ releaseDate: pastDate, type: 'single' }),
    );
    expect(status).toHaveBeenCalledWith(201);
  });

  it('propagates a validation rejection from the service (e.g. invalid release type)', async () => {
    const { AppError } = jest.requireActual('../errors/AppError');
    mockCreate.mockRejectedValue(AppError.validation('type must be one of album, single, ep'));
    const req = mockReq({
      user: { id: 'artist1' },
      body: { title: 'My Album', releaseDate: '2027-01-01T00:00:00.000Z', type: 'not-a-type' },
    });
    const { res, status } = mockRes();

    await ReleaseController.create(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('ReleaseController.list', () => {
  it('applies default pagination', async () => {
    mockFindPaginated.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    const req = mockReq();
    const { res } = mockRes();

    await ReleaseController.list(req, res);

    expect(mockFindPaginated).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('caps the page limit at 100', async () => {
    mockFindPaginated.mockResolvedValue({ data: [], pagination: {} });
    const req = mockReq({ query: { page: '1', limit: '500' } });
    const { res } = mockRes();

    await ReleaseController.list(req, res);

    expect(mockFindPaginated).toHaveBeenCalledWith(1, 100, undefined);
  });

  it('filters by artistId when provided', async () => {
    mockFindPaginated.mockResolvedValue({ data: [], pagination: {} });
    const req = mockReq({ query: { artistId: 'artist1' } });
    const { res } = mockRes();

    await ReleaseController.list(req, res);

    expect(mockFindPaginated).toHaveBeenCalledWith(1, 20, 'artist1');
  });
});

describe('ReleaseController.getById', () => {
  it('returns the release', async () => {
    mockGetById.mockResolvedValue({ id: 'r1', title: 'My Album' });
    const req = mockReq({ params: { id: 'r1' } });
    const { res, json } = mockRes();

    await ReleaseController.getById(req, res);

    expect(mockGetById).toHaveBeenCalledWith('r1');
    expect(json).toHaveBeenCalledWith({ success: true, data: { id: 'r1', title: 'My Album' } });
  });

  it('propagates a not-found error from the service', async () => {
    const { AppError } = jest.requireActual('../errors/AppError');
    mockGetById.mockRejectedValue(AppError.notFound('Release not found'));
    const req = mockReq({ params: { id: 'ghost' } });
    const { res, status } = mockRes();

    await ReleaseController.getById(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});

describe('ReleaseController.update', () => {
  it('updates a release for its owning artist', async () => {
    mockUpdate.mockResolvedValue({ id: 'r1', title: 'Renamed Album' });
    const req = mockReq({
      user: { id: 'artist1' },
      params: { id: 'r1' },
      body: { title: 'Renamed Album' },
    });
    const { res, status, json } = mockRes();

    await ReleaseController.update(req, res);

    expect(mockUpdate).toHaveBeenCalledWith('r1', 'artist1', {
      title: 'Renamed Album',
      releaseDate: undefined,
      type: undefined,
      coverArt: undefined,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'r1', title: 'Renamed Album' },
    });
  });

  it("propagates an authorization rejection when updating another artist's release", async () => {
    const { AppError } = jest.requireActual('../errors/AppError');
    mockUpdate.mockRejectedValue(AppError.authorization('Not the owning artist'));
    const req = mockReq({
      user: { id: 'not-the-owner' },
      params: { id: 'r1' },
      body: { title: 'Hijacked' },
    });
    const { res, status } = mockRes();

    await ReleaseController.update(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });
});
