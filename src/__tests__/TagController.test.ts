import 'reflect-metadata';

const mockListAllGroupedByCategory = jest.fn();
const mockGetSongsByTagSlug = jest.fn();
const mockAddTagsToSong = jest.fn();

jest.mock('../services/TagService', () => ({
  TagService: jest.fn().mockImplementation(() => ({
    listAllGroupedByCategory: mockListAllGroupedByCategory,
    getSongsByTagSlug: mockGetSongsByTagSlug,
    addTagsToSong: mockAddTagsToSong,
  })),
}));

import { TagController } from '../controllers/TagController';
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
  mockListAllGroupedByCategory.mockReset();
  mockGetSongsByTagSlug.mockReset();
  mockAddTagsToSong.mockReset();
});

describe('TagController.listAll', () => {
  it('returns tags grouped by category', async () => {
    mockListAllGroupedByCategory.mockResolvedValue({ genre: ['afrobeat'], mood: ['chill'] });
    const req = mockReq();
    const { res, status, json } = mockRes();

    await TagController.listAll(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { genre: ['afrobeat'], mood: ['chill'] },
    });
  });
});

describe('TagController.getSongsByTag', () => {
  it('returns songs for a given tag slug', async () => {
    mockGetSongsByTagSlug.mockResolvedValue([{ id: 's1', title: 'Sunrise' }]);
    const req = mockReq({ params: { slug: 'afrobeat' } });
    const { res, json } = mockRes();

    await TagController.getSongsByTag(req, res);

    expect(mockGetSongsByTagSlug).toHaveBeenCalledWith('afrobeat');
    expect(json).toHaveBeenCalledWith({ success: true, data: [{ id: 's1', title: 'Sunrise' }] });
  });
});

describe('TagController.addTagsToSong', () => {
  it('rejects a non-array tags payload', async () => {
    const req = mockReq({ params: { id: 'song1' }, body: { tags: 'afrobeat' } });
    const { res, status } = mockRes();

    await TagController.addTagsToSong(req, res);

    expect(mockAddTagsToSong).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('rejects an empty tags array', async () => {
    const req = mockReq({ params: { id: 'song1' }, body: { tags: [] } });
    const { res, status } = mockRes();

    await TagController.addTagsToSong(req, res);

    expect(mockAddTagsToSong).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('adds tags to a song', async () => {
    mockAddTagsToSong.mockResolvedValue({ songId: 'song1', tags: ['afrobeat', 'chill'] });
    const req = mockReq({
      params: { id: 'song1' },
      body: { tags: ['afrobeat', 'chill'], category: 'genre' },
    });
    const { res, status, json } = mockRes();

    await TagController.addTagsToSong(req, res);

    expect(mockAddTagsToSong).toHaveBeenCalledWith('song1', ['afrobeat', 'chill'], 'genre');
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { songId: 'song1', tags: ['afrobeat', 'chill'] },
    });
  });

  it('surfaces duplicate-tag rejection from the service (issue #318)', async () => {
    // Case-insensitive duplicate handling ("Afrobeat" vs "afrobeat") is a
    // service-layer concern (TagService normalizes/dedupes); the controller's
    // job is just to pass the raw tags array through and propagate whatever
    // the service decides about duplicates.
    const { AppError } = jest.requireActual('../errors/AppError');
    mockAddTagsToSong.mockRejectedValue(
      AppError.conflict('Tag "afrobeat" is already applied to this song'),
    );

    const req = mockReq({
      params: { id: 'song1' },
      body: { tags: ['Afrobeat'], category: 'genre' },
    });
    const { res, status } = mockRes();

    await TagController.addTagsToSong(req, res);

    expect(mockAddTagsToSong).toHaveBeenCalledWith('song1', ['Afrobeat'], 'genre');
    expect(status).toHaveBeenCalledWith(409);
  });
});
