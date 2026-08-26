import 'reflect-metadata';

// ── Module-level mock variables (Jest hoisting requires `mock` prefix) ──

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockGetById = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockAddSong = jest.fn();
const mockRemoveSong = jest.fn();
const mockReorder = jest.fn();

jest.mock('../services/PlaylistService', () => ({
  PlaylistService: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    listForUser: mockList,
    getById: mockGetById,
    update: mockUpdate,
    remove: mockRemove,
    addSong: mockAddSong,
    removeSong: mockRemoveSong,
    reorder: mockReorder,
  })),
}));

import { PlaylistController } from '../controllers/PlaylistController';
import { Request, Response } from 'express';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { res: Response; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { json, status } as unknown as Response, json, status };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockList.mockReset();
  mockGetById.mockReset();
  mockUpdate.mockReset();
  mockRemove.mockReset();
  mockAddSong.mockReset();
  mockRemoveSong.mockReset();
  mockReorder.mockReset();
});

describe('PlaylistController.create', () => {
  it('creates a playlist for the authenticated user', async () => {
    const playlist = { id: 'pl-1', name: 'Road Trip' };
    mockCreate.mockResolvedValue(playlist);

    const req = mockReq({ body: { name: 'Road Trip', isPublic: false } });
    const { res, json, status } = mockRes();

    await PlaylistController.create(req, res);

    expect(mockCreate).toHaveBeenCalledWith('user-1', {
      name: 'Road Trip',
      description: undefined,
      isPublic: false,
      coverImageUrl: undefined,
    });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ success: true, data: playlist });
  });

  it('propagates service errors', async () => {
    mockCreate.mockRejectedValue(new Error('Playlist name is required'));

    const req = mockReq({ body: { name: '' } });
    const { res, status } = mockRes();

    await PlaylistController.create(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('PlaylistController.list', () => {
  it('lists the caller playlists with pagination', async () => {
    mockList.mockResolvedValue({ data: [], pagination: { total: 0 } });

    const req = mockReq({ query: { page: '2', limit: '10' } });
    const { res, json } = mockRes();

    await PlaylistController.list(req, res);

    expect(mockList).toHaveBeenCalledWith('user-1', 2, 10);
    expect(json).toHaveBeenCalledWith({ success: true, data: [], pagination: { total: 0 } });
  });
});

describe('PlaylistController.getById', () => {
  it('returns the playlist with ordered songs', async () => {
    const playlist = { id: 'pl-1', songs: [] };
    mockGetById.mockResolvedValue(playlist);

    const req = mockReq({ params: { id: 'pl-1' } });
    const { res, json } = mockRes();

    await PlaylistController.getById(req, res);

    expect(mockGetById).toHaveBeenCalledWith('pl-1', 'user-1');
    expect(json).toHaveBeenCalledWith({ success: true, data: playlist });
  });
});

describe('PlaylistController.update', () => {
  it('updates metadata', async () => {
    const playlist = { id: 'pl-1', name: 'Renamed' };
    mockUpdate.mockResolvedValue(playlist);

    const req = mockReq({ params: { id: 'pl-1' }, body: { name: 'Renamed' } });
    const { res, json } = mockRes();

    await PlaylistController.update(req, res);

    expect(mockUpdate).toHaveBeenCalledWith('pl-1', 'user-1', {
      name: 'Renamed',
      description: undefined,
      isPublic: undefined,
      coverImageUrl: undefined,
    });
    expect(json).toHaveBeenCalledWith({ success: true, data: playlist });
  });

  it('rejects an empty update body', async () => {
    const req = mockReq({ params: { id: 'pl-1' }, body: {} });
    const { res, status } = mockRes();

    await PlaylistController.update(req, res);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('PlaylistController.remove', () => {
  it('deletes the playlist', async () => {
    mockRemove.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 'pl-1' } });
    const { res, json, status } = mockRes();

    await PlaylistController.remove(req, res);

    expect(mockRemove).toHaveBeenCalledWith('pl-1', 'user-1');
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, message: 'Playlist deleted' });
  });
});

describe('PlaylistController.addSong / removeSong', () => {
  it('adds a song to the playlist', async () => {
    const entry = { id: 'ps-1', songId: 'song-1' };
    mockAddSong.mockResolvedValue(entry);

    const req = mockReq({ params: { id: 'pl-1' }, body: { songId: 'song-1' } });
    const { res, json, status } = mockRes();

    await PlaylistController.addSong(req, res);

    expect(mockAddSong).toHaveBeenCalledWith('pl-1', 'user-1', 'song-1');
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ success: true, data: entry });
  });

  it('requires a songId', async () => {
    const req = mockReq({ params: { id: 'pl-1' }, body: {} });
    const { res, status } = mockRes();

    await PlaylistController.addSong(req, res);

    expect(mockAddSong).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('removes a song from the playlist', async () => {
    mockRemoveSong.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 'pl-1', songId: 'song-1' } });
    const { res, json } = mockRes();

    await PlaylistController.removeSong(req, res);

    expect(mockRemoveSong).toHaveBeenCalledWith('pl-1', 'user-1', 'song-1');
    expect(json).toHaveBeenCalledWith({ success: true, message: 'Song removed from playlist' });
  });
});

describe('PlaylistController.reorder', () => {
  it('reorders songs', async () => {
    const playlist = { id: 'pl-1' };
    mockReorder.mockResolvedValue(playlist);

    const req = mockReq({ params: { id: 'pl-1' }, body: { songIds: ['song-2', 'song-1'] } });
    const { res, json } = mockRes();

    await PlaylistController.reorder(req, res);

    expect(mockReorder).toHaveBeenCalledWith('pl-1', 'user-1', ['song-2', 'song-1']);
    expect(json).toHaveBeenCalledWith({ success: true, data: playlist });
  });

  it('rejects a missing songIds array', async () => {
    const req = mockReq({ params: { id: 'pl-1' }, body: {} });
    const { res, status } = mockRes();

    await PlaylistController.reorder(req, res);

    expect(mockReorder).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });
});
