import { DataSource } from 'typeorm';
import { seedTestDatabase, assertTestEnvironmentSafety } from '../../src/seeders/test.seeder';
import { User, UserRole } from '../../src/entities/User';
import { Genre } from '../../src/entities/Genre';
import { Album } from '../../src/entities/Album';
import { Song } from '../../src/entities/Song';
import { TransactionLog } from '../../src/entities/TransactionLog';
import { RoyaltyPayout } from '../../src/entities/RoyaltyPayout';

describe('Test Database Seeder Integration Suite', () => {
  let testDataSource: DataSource;

  beforeAll(async () => {
    // Create an isolated in-memory SQLite database for integration testing
    testDataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      dropSchema: true,
      synchronize: true,
      logging: false,
      entities: [User, Genre, Album, Song, TransactionLog, RoyaltyPayout],
    });

    await testDataSource.initialize();
  });

  afterAll(async () => {
    if (testDataSource.isInitialized) {
      await testDataSource.destroy();
    }
  });

  describe('Environment Safety Guards', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalAllow = process.env.ALLOW_TEST_SEED;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_TEST_SEED = originalAllow;
    });

    it('rejects execution when NODE_ENV is production without ALLOW_TEST_SEED', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_SEED;

      expect(() => assertTestEnvironmentSafety()).toThrow(
        /Refusing to seed test data in a PRODUCTION environment/,
      );
    });

    it('allows execution when NODE_ENV is production if ALLOW_TEST_SEED=true is set', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SEED = 'true';

      expect(() => assertTestEnvironmentSafety()).not.toThrow();
    });

    it('allows execution in development and test environments', () => {
      process.env.NODE_ENV = 'test';
      expect(() => assertTestEnvironmentSafety()).not.toThrow();

      process.env.NODE_ENV = 'development';
      expect(() => assertTestEnvironmentSafety()).not.toThrow();
    });
  });

  describe('Database Seeding & Idempotence', () => {
    it('successfully seeds representative users, genres, albums, and songs', async () => {
      const data = await seedTestDatabase(testDataSource);

      expect(data.users.length).toBe(5);
      expect(data.genres.length).toBeGreaterThanOrEqual(5);
      expect(data.albums.length).toBe(2);
      expect(data.songs.length).toBe(3);

      const userRepo = testDataSource.getRepository(User);
      const admin = await userRepo.findOne({ where: { email: 'admin@audioblocks.test' } });
      expect(admin).toBeDefined();
      expect(admin?.role).toBe(UserRole.ADMIN);

      const artists = await userRepo.find({ where: { role: UserRole.ARTIST } });
      expect(artists.length).toBe(2);

      const listeners = await userRepo.find({ where: { role: UserRole.LISTENER } });
      expect(listeners.length).toBe(2);

      const albumRepo = testDataSource.getRepository(Album);
      const albums = await albumRepo.find();
      expect(albums.length).toBe(2);
      expect(albums[0].songs.length).toBeGreaterThan(0);

      const songRepo = testDataSource.getRepository(Song);
      const songs = await songRepo.find();
      expect(songs.length).toBe(3);
    });

    it('is completely idempotent when executed multiple consecutive times', async () => {
      const userRepo = testDataSource.getRepository(User);
      const albumRepo = testDataSource.getRepository(Album);
      const songRepo = testDataSource.getRepository(Song);
      const genreRepo = testDataSource.getRepository(Genre);

      const initialUserCount = await userRepo.count();
      const initialAlbumCount = await albumRepo.count();
      const initialSongCount = await songRepo.count();
      const initialGenreCount = await genreRepo.count();

      // Second seed run
      const dataSecondRun = await seedTestDatabase(testDataSource);

      const postUserCount = await userRepo.count();
      const postAlbumCount = await albumRepo.count();
      const postSongCount = await songRepo.count();
      const postGenreCount = await genreRepo.count();

      expect(postUserCount).toBe(initialUserCount);
      expect(postAlbumCount).toBe(initialAlbumCount);
      expect(postSongCount).toBe(initialSongCount);
      expect(postGenreCount).toBe(initialGenreCount);
      expect(dataSecondRun.users.length).toBe(initialUserCount);
    });
  });
});
