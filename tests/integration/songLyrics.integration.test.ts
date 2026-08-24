process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import AppDataSource from '../../src/config/db';
import app from '../../src/app';
import { User } from '../../src/entities/User';
import { Song } from '../../src/entities/Song';

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
  },
}));

describe('Song Lyrics API Integration', () => {
  let userToken: string;
  let testUser: User;
  let testSongWithLyrics: Song;
  let testSongWithoutLyrics: Song;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(User);
    const songRepo = AppDataSource.getRepository(Song);

    // Create test user
    testUser = userRepo.create({
      email: 'lyrics-test@example.com',
      username: 'lyricstest',
      passwordHash: 'hashedpassword',
    });
    await userRepo.save(testUser);

    userToken = jwt.sign(
      { id: testUser.id, role: 'artist' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' },
    );

    // Create a song with lyrics
    testSongWithLyrics = songRepo.create({
      title: 'Song With Lyrics',
      artistId: testUser.id,
      coverArtPath: 'test.jpg',
      status: 'ready',
      lyrics: 'Hello from the other side',
      language: 'en',
    });
    await songRepo.save(testSongWithLyrics);

    // Create a song without lyrics
    testSongWithoutLyrics = songRepo.create({
      title: 'Song Without Lyrics',
      artistId: testUser.id,
      coverArtPath: 'test.jpg',
      status: 'ready',
    });
    await songRepo.save(testSongWithoutLyrics);
  });

  afterAll(async () => {
    const userRepo = AppDataSource.getRepository(User);
    const songRepo = AppDataSource.getRepository(Song);
    await songRepo.delete({ artistId: testUser.id });
    await userRepo.delete({ email: 'lyrics-test@example.com' });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe('GET /api/songs/:id/lyrics', () => {
    it('returns lyrics for a valid song ID', async () => {
      const response = await request(app)
        .get(`/api/songs/${testSongWithLyrics.id}/lyrics`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.lyrics).toBe('Hello from the other side');
      expect(response.body.data.language).toBe('en');
    });

    it('returns 404 if song has no lyrics', async () => {
      const response = await request(app)
        .get(`/api/songs/${testSongWithoutLyrics.id}/lyrics`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Lyrics not found for this song');
    });

    it('returns 404 if song does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/songs/${fakeId}/lyrics`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Song not found');
    });

    it('requires authentication', async () => {
      const response = await request(app).get(`/api/songs/${testSongWithLyrics.id}/lyrics`);

      expect(response.status).toBe(401);
    });
  });
});
