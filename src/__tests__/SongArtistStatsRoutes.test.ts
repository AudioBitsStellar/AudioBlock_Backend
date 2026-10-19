import 'reflect-metadata';
import request from 'supertest';
import express, { Express } from 'express';
import songRoutes from '../routes/SongRoutes';
import artistRoutes from '../routes/artistRoutes';
import AppDataSource from '../config/db';
import { SongController } from '../controllers/SongController';

// Mock SongStatsService
const mockFullStats = {
  window: '30d',
  from: '2026-10-11T00:00:00.000Z',
  to: '2026-10-18T00:00:00.000Z',
  songCount: 2,
  totals: {
    plays: 120,
    uniqueListeners: 45,
    saves: 30,
    revenueStroops: '5000000',
    followers: 12,
  },
  previous: {
    plays: 100,
    uniqueListeners: 40,
    saves: 25,
    revenueStroops: '4000000',
  },
  comparison: {
    playsPct: 20,
    uniqueListenersPct: 12.5,
    savesPct: 20,
    revenuePct: 25,
  },
  topSongs: [{ songId: 'song-uuid-1', title: 'Stellar Track', plays: 90 }],
  series: [
    { bucket: '2026-10-11', plays: 10, saves: 2, revenueStroops: '500000' },
  ],
};

const mockSong = {
  id: 'song-uuid-1',
  title: 'Stellar Track',
  artistId: 'artist-uuid-1',
};

const mockArtist = {
  id: 'artist-uuid-1',
  name: 'Stellar Artist',
};

jest.mock('../config/db', () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('../services/Song/SongStatsService', () => {
  return {
    SongStatsService: jest.fn().mockImplementation(() => ({
      getSongStats: jest.fn(async (songId: string, _window: string) => {
        if (songId === 'song-uuid-1') return mockFullStats;
        const err: any = new Error('Song not found');
        err.statusCode = 404;
        throw err;
      }),
      getArtistStats: jest.fn(async (artistId: string, _window: string) => {
        if (artistId === 'artist-uuid-1') return mockFullStats;
        const err: any = new Error('Artist not found');
        err.statusCode = 404;
        throw err;
      }),
    })),
    parseWindow: jest.fn((w?: string) => {
      const allowed = ['7d', '30d', '90d', 'all-time'];
      const target = (w || '30d').toLowerCase();
      if (!allowed.includes(target)) {
        throw new Error(`Invalid window: "${w}". Expected one of: ${allowed.join(', ')}`);
      }
      return target;
    }),
  };
});

describe('Song and Artist Stats Endpoints (Issue #814)', () => {
  let app: Express;
  let authUser: any = null;

  beforeAll(() => {
    // Setup Express application
    app = express();
    app.use(express.json());

    // Inject caller into request for auth simulation
    app.use((req, _res, next) => {
      if (authUser) {
        (req as any).user = authUser;
      }
      next();
    });

    app.use('/api/song', songRoutes);
    app.use('/api/artist', artistRoutes);

    // Mock typeorm getRepository for Song and User
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      const name = entity?.name;
      if (name === 'Song') {
        return {
          findOne: jest.fn(async ({ where }: any) => {
            if (where?.id === 'song-uuid-1') return mockSong;
            return null;
          }),
        };
      }
      if (name === 'User') {
        return {
          findOne: jest.fn(async ({ where }: any) => {
            if (where?.id === 'artist-uuid-1') return mockArtist;
            return null;
          }),
        };
      }
      return {};
    });
  });

  beforeEach(() => {
    authUser = null;
  });

  describe('GET /api/song/:id/stats', () => {
    it('returns only public metrics for unauthenticated users', async () => {
      const res = await request(app)
        .get('/api/song/song-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.plays).toBe(120);
      expect(res.body.data.totals.saves).toBe(30);

      // Owner-only fields MUST NOT be present
      expect(res.body.data.totals.uniqueListeners).toBeUndefined();
      expect(res.body.data.totals.revenueStroops).toBeUndefined();
      if (res.body.data.previous) {
        expect(res.body.data.previous.uniqueListeners).toBeUndefined();
        expect(res.body.data.previous.revenueStroops).toBeUndefined();
      }
      if (res.body.data.comparison) {
        expect(res.body.data.comparison.uniqueListenersPct).toBeUndefined();
        expect(res.body.data.comparison.revenuePct).toBeUndefined();
      }

      // Check caching headers
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('max-age=300');
      expect(res.headers['vary']).toBe('Authorization');
    });

    it('returns only public metrics for a non-owner authenticated user', async () => {
      authUser = { id: 'other-user-uuid', role: 'listener' };

      const res = await request(app)
        .get('/api/song/song-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.plays).toBe(120);
      expect(res.body.data.totals.uniqueListeners).toBeUndefined();
      expect(res.body.data.totals.revenueStroops).toBeUndefined();

      expect(res.headers['cache-control']).toContain('public');
    });

    it('returns complete metrics including revenue and unique listeners to song owner', async () => {
      authUser = { id: 'artist-uuid-1', role: 'artist' };

      const res = await request(app)
        .get('/api/song/song-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.plays).toBe(120);
      expect(res.body.data.totals.uniqueListeners).toBe(45);
      expect(res.body.data.totals.revenueStroops).toBe('5000000');
      expect(res.body.data.comparison.revenuePct).toBe(25);

      // Owner gets private caching header
      expect(res.headers['cache-control']).toContain('private');
      expect(res.headers['cache-control']).toContain('max-age=300');
      expect(res.headers['vary']).toBe('Authorization');
    });

    it('returns complete metrics to an admin user', async () => {
      authUser = { id: 'admin-user-uuid', role: 'admin' };

      const res = await request(app)
        .get('/api/song/song-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.uniqueListeners).toBe(45);
      expect(res.body.data.totals.revenueStroops).toBe('5000000');
    });

    it('rejects invalid time window with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/song/song-uuid-1/stats?window=invalid_period')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid window');
    });

    it('returns 404 when song does not exist', async () => {
      const res = await request(app)
        .get('/api/song/nonexistent-song/stats')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('Artist stats endpoints (/api/artist/:id/stats and /api/song/artist/:artistId/stats)', () => {
    it('is reachable via GET /api/artist/:id/stats and returns public counts to non-owner', async () => {
      const res = await request(app)
        .get('/api/artist/artist-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.plays).toBe(120);
      expect(res.body.data.totals.saves).toBe(30);
      expect(res.body.data.totals.followers).toBe(12);
      expect(res.body.data.totals.uniqueListeners).toBeUndefined();
      expect(res.body.data.totals.revenueStroops).toBeUndefined();
      expect(res.headers['cache-control']).toContain('public');
    });

    it('is reachable via GET /api/song/artist/:artistId/stats and returns owner metrics to artist', async () => {
      authUser = { id: 'artist-uuid-1', role: 'artist' };

      const res = await request(app)
        .get('/api/song/artist/artist-uuid-1/stats')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totals.plays).toBe(120);
      expect(res.body.data.totals.uniqueListeners).toBe(45);
      expect(res.body.data.totals.revenueStroops).toBe('5000000');
      expect(res.body.data.totals.followers).toBe(12);
      expect(res.headers['cache-control']).toContain('private');
    });

    it('rejects invalid window on artist stats endpoint', async () => {
      const res = await request(app)
        .get('/api/artist/artist-uuid-1/stats?window=2years')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid window');
    });
  });
});
