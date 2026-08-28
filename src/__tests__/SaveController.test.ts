import 'reflect-metadata';

const mockSaveSong = jest.fn();
const mockUnsaveSong = jest.fn();
const mockGetUserLibrary = jest.fn();
const mockGetUserCollections = jest.fn();
const mockHasUserSaved = jest.fn();

jest.mock('../services/SaveService', () => ({
  SaveService: jest.fn().mockImplementation(() => ({
    saveSong: mockSaveSong,
    unsaveSong: mockUnsaveSong,
    getUserLibrary: mockGetUserLibrary,
    getUserCollections: mockGetUserCollections,
    hasUserSaved: mockHasUserSaved,
  })),
}));

import { SaveController } from '../controllers/SaveController';
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
  mockSaveSong.mockReset();
  mockUnsaveSong.mockReset();
  mockGetUserLibrary.mockReset();
  mockGetUserCollections.mockReset();
  mockHasUserSaved.mockReset();
});

describe('SaveController.saveSong — idempotency (issue #319)', () => {
  it('rejects an unauthenticated request', async () => {
    const controller = new SaveController();
    const req = mockReq({ params: { id: 'song1' } });
    const { res, status } = mockRes();

    await controller.saveSong(req, res);

    expect(mockSaveSong).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('returns 201 on the first save', async () => {
    mockSaveSong.mockResolvedValue({
      save: { id: 'sv1', songId: 'song1', collection: null, createdAt: '2026-01-01T00:00:00.000Z' },
      alreadySaved: false,
    });
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' }, params: { id: 'song1' } });
    const { res, status, json } = mockRes();

    await controller.saveSong(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Song saved to library',
        alreadySaved: false,
        isSaved: true,
      }),
    );
  });

  it('returns 200 with alreadySaved:true on a duplicate save, without creating a duplicate', async () => {
    mockSaveSong.mockResolvedValue({
      save: { id: 'sv1', songId: 'song1', collection: null, createdAt: '2026-01-01T00:00:00.000Z' },
      alreadySaved: true,
    });
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' }, params: { id: 'song1' } });
    const { res, status, json } = mockRes();

    // Save twice — the second call is what exercises idempotency.
    await controller.saveSong(req, res);
    await controller.saveSong(req, res);

    expect(mockSaveSong).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith(200);
    expect(json).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Song already saved', alreadySaved: true, isSaved: true }),
    );
  });

  it('passes the collection through when provided', async () => {
    mockSaveSong.mockResolvedValue({
      save: {
        id: 'sv1',
        songId: 'song1',
        collection: 'Favorites',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      alreadySaved: false,
    });
    const controller = new SaveController();
    const req = mockReq({
      user: { id: 'user1' },
      params: { id: 'song1' },
      body: { collection: 'Favorites' },
    });
    const { res } = mockRes();

    await controller.saveSong(req, res);

    expect(mockSaveSong).toHaveBeenCalledWith('user1', 'song1', 'Favorites');
  });
});

describe('SaveController.unsaveSong (issue #319)', () => {
  it('rejects an unauthenticated request', async () => {
    const controller = new SaveController();
    const req = mockReq({ params: { id: 'song1' } });
    const { res, status } = mockRes();

    await controller.unsaveSong(req, res);

    expect(mockUnsaveSong).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('removes a saved song and reports isSaved:false', async () => {
    mockUnsaveSong.mockResolvedValue(true);
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' }, params: { id: 'song1' } });
    const { res, status, json } = mockRes();

    await controller.unsaveSong(req, res);

    expect(mockUnsaveSong).toHaveBeenCalledWith('user1', 'song1', undefined);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      message: 'Song removed from library',
      removed: true,
      isSaved: false,
    });
  });

  it('scopes the removal to a single collection when specified', async () => {
    mockUnsaveSong.mockResolvedValue(true);
    const controller = new SaveController();
    const req = mockReq({
      user: { id: 'user1' },
      params: { id: 'song1' },
      query: { collection: 'Favorites' },
    });
    const { res } = mockRes();

    await controller.unsaveSong(req, res);

    expect(mockUnsaveSong).toHaveBeenCalledWith('user1', 'song1', 'Favorites');
  });

  it('reports removed:false when the song was never saved', async () => {
    mockUnsaveSong.mockResolvedValue(false);
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' }, params: { id: 'song1' } });
    const { res, json } = mockRes();

    await controller.unsaveSong(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ removed: false, isSaved: false }));
  });
});

describe('SaveController.getSaveStatus', () => {
  it('rejects an unauthenticated request', async () => {
    const controller = new SaveController();
    const req = mockReq({ params: { id: 'song1' } });
    const { res, status } = mockRes();

    await controller.getSaveStatus(req, res);

    expect(mockHasUserSaved).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('reports whether the caller has saved the song', async () => {
    mockHasUserSaved.mockResolvedValue(true);
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' }, params: { id: 'song1' } });
    const { res, json } = mockRes();

    await controller.getSaveStatus(req, res);

    expect(mockHasUserSaved).toHaveBeenCalledWith('user1', 'song1');
    expect(json).toHaveBeenCalledWith({ songId: 'song1', isSaved: true });
  });
});

describe('SaveController.getMyLibrary / getMyCollections', () => {
  it('applies default pagination to the library listing', async () => {
    mockGetUserLibrary.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' } });
    const { res } = mockRes();

    await controller.getMyLibrary(req, res);

    expect(mockGetUserLibrary).toHaveBeenCalledWith('user1', 1, 20, undefined);
  });

  it('lists the caller collections with a total count', async () => {
    mockGetUserCollections.mockResolvedValue([{ name: 'Favorites', count: 3 }]);
    const controller = new SaveController();
    const req = mockReq({ user: { id: 'user1' } });
    const { res, json } = mockRes();

    await controller.getMyCollections(req, res);

    expect(json).toHaveBeenCalledWith({
      collections: [{ name: 'Favorites', count: 3 }],
      total: 1,
    });
  });
});
