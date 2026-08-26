import 'reflect-metadata';

const mockGetGenresWithSongCounts = jest.fn();
const mockGetGenreById = jest.fn();
const mockGetSongsByGenre = jest.fn();

jest.mock('../services/GenreService', () => ({
  GenreService: jest.fn().mockImplementation(() => ({
    getGenresWithSongCounts: mockGetGenresWithSongCounts,
    getGenreById: mockGetGenreById,
  })),
}));
jest.mock('../services/SongService', () => ({
  SongService: jest.fn().mockImplementation(() => ({
    getSongsByGenre: mockGetSongsByGenre,
  })),
}));

import { GenreController } from '../controllers/GenreController';
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
  mockGetGenresWithSongCounts.mockReset();
  mockGetGenreById.mockReset();
  mockGetSongsByGenre.mockReset();
});

describe('GenreController.listGenres', () => {
  it('returns all genres with song counts', async () => {
    mockGetGenresWithSongCounts.mockResolvedValue([{ id: 'g1', name: 'Afrobeat', songCount: 5 }]);

    const req = mockReq();
    const { res, json } = mockRes();

    await GenreController.listGenres(req, res);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'g1', name: 'Afrobeat', songCount: 5 }],
    });
  });
});

describe('GenreController.getGenreSongs', () => {
  it('returns paginated songs for a genre with the genre name', async () => {
    mockGetGenreById.mockResolvedValue({ id: 'g1', name: 'Afrobeat' });
    mockGetSongsByGenre.mockResolvedValue({
      songs: [{ id: 's1', title: 'Sunrise' }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const req = mockReq({
      params: { id: 'g1' },
      query: { page: '1', limit: '20', sort: 'newest' },
    });
    const { res, json } = mockRes();

    await GenreController.getGenreSongs(req, res);

    expect(mockGetGenreById).toHaveBeenCalledWith('g1');
    expect(mockGetSongsByGenre).toHaveBeenCalledWith('g1', 1, 20, 'newest');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        genre: { id: 'g1', name: 'Afrobeat' },
        songs: [{ id: 's1', title: 'Sunrise' }],
      }),
    );
  });

  it('passes the sort query parameter through', async () => {
    mockGetGenreById.mockResolvedValue({ id: 'g1', name: 'Afrobeat' });
    mockGetSongsByGenre.mockResolvedValue({
      songs: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ params: { id: 'g1' }, query: { sort: 'most_played' } });
    const { res } = mockRes();

    await GenreController.getGenreSongs(req, res);

    expect(mockGetSongsByGenre).toHaveBeenCalledWith('g1', 1, 20, 'most_played');
  });

  it('returns 404 when the genre does not exist', async () => {
    mockGetGenreById.mockResolvedValue(null);

    const req = mockReq({ params: { id: 'ghost' } });
    const { res, status } = mockRes();

    await GenreController.getGenreSongs(req, res);

    expect(mockGetSongsByGenre).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
  });
});
