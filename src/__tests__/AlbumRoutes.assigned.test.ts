import express from 'express';
import request from 'supertest';

const findPaginated = jest.fn();
jest.mock('../services/AlbumService', () => ({
  AlbumService: jest.fn().mockImplementation(() => ({ findPaginated })),
}));

import AlbumRoutes from '../routes/AlbumRoutes';

describe('GET /api/albums (#740)', () => {
  const app = express();
  app.use('/api/albums', AlbumRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    findPaginated.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('returns a paginated album list', async () => {
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(findPaginated).toHaveBeenCalledWith(1, 20, undefined);
    expect(res.body.success).toBe(true);
  });

  it('passes artistId and caps limit at 100', async () => {
    await request(app).get('/api/albums?artistId=artist-1&limit=500');
    expect(findPaginated).toHaveBeenCalledWith(1, 100, 'artist-1');
  });

  it.each(['/api/albums?page=nope', '/api/albums?limit=0', '/api/albums?limit=2.5'])(
    'rejects invalid pagination: %s',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(
        expect.objectContaining({ success: false, type: 'VALIDATION_FAILED' }),
      );
      expect(findPaginated).not.toHaveBeenCalled();
    },
  );
});
