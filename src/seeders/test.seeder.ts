import AppDataSource from '../config/db';
import { User, UserRole } from '../entities/User';
import { Genre } from '../entities/Genre';
import { Album } from '../entities/Album';
import { Song } from '../entities/Song';
import bcrypt from 'bcrypt';

/**
 * Safety guard: ensures test seeding does NOT run against production databases
 * unless explicitly forced with ALLOW_TEST_SEED=true.
 */
export function assertTestEnvironmentSafety(): void {
  const env = process.env.NODE_ENV || 'development';
  const allowTestSeed = process.env.ALLOW_TEST_SEED === 'true';

  if (env === 'production' && !allowTestSeed) {
    throw new Error(
      '⛔ Refusing to seed test data in a PRODUCTION environment! Set ALLOW_TEST_SEED=true to override if strictly intentional.',
    );
  }
}

export interface SeededTestData {
  users: User[];
  genres: Genre[];
  albums: Album[];
  songs: Song[];
}

/**
 * Seeds the database with representative users, genres, albums, and songs for local integration testing.
 * This function is idempotent: running it multiple times will not create duplicates or fail constraint checks.
 */
export async function seedTestDatabase(dataSource = AppDataSource): Promise<SeededTestData> {
  assertTestEnvironmentSafety();

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const userRepo = dataSource.getRepository(User);
  const genreRepo = dataSource.getRepository(Genre);
  const albumRepo = dataSource.getRepository(Album);
  const songRepo = dataSource.getRepository(Song);

  // 1. Seed Genres
  const genreNames = ['Pop', 'Hip-Hop', 'Electronic', 'Rock', 'Afrobeat', 'Jazz', 'R&B'];
  const seededGenres: Genre[] = [];

  for (const name of genreNames) {
    let genre = await genreRepo.findOne({ where: { name } });
    if (!genre) {
      genre = genreRepo.create({ name });
      genre = await genreRepo.save(genre);
    }
    seededGenres.push(genre);
  }

  // 2. Seed Users
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const userDefinitions: Array<Partial<User>> = [
    {
      email: 'admin@audioblocks.test',
      username: 'testadmin',
      name: 'Test Administrator',
      role: UserRole.ADMIN,
      emailVerified: true,
      passwordHash,
      walletAddress: 'GAADMIN77777777777777777777777777777777777777777777777777',
    },
    {
      email: 'artist1@audioblocks.test',
      username: 'dj_stellar',
      name: 'DJ Stellar',
      role: UserRole.ARTIST,
      emailVerified: true,
      passwordHash,
      walletAddress: 'GAARTIST1111111111111111111111111111111111111111111111111',
    },
    {
      email: 'artist2@audioblocks.test',
      username: 'luna_beats',
      name: 'Luna Beats',
      role: UserRole.ARTIST,
      emailVerified: true,
      passwordHash,
      walletAddress: 'GAARTIST2222222222222222222222222222222222222222222222222',
    },
    {
      email: 'listener1@audioblocks.test',
      username: 'audiophile_john',
      name: 'John Listener',
      role: UserRole.LISTENER,
      emailVerified: true,
      passwordHash,
      walletAddress: 'GALISTENER111111111111111111111111111111111111111111111111',
    },
    {
      email: 'listener2@audioblocks.test',
      username: 'music_lover_sarah',
      name: 'Sarah Music',
      role: UserRole.LISTENER,
      emailVerified: true,
      passwordHash,
      walletAddress: 'GALISTENER222222222222222222222222222222222222222222222222',
    },
  ];

  const seededUsers: User[] = [];
  for (const def of userDefinitions) {
    let user = await userRepo.findOne({ where: { email: def.email } });
    if (!user) {
      user = userRepo.create(def);
      user = await userRepo.save(user);
    }
    seededUsers.push(user);
  }

  const artist1 = seededUsers.find((u) => u.email === 'artist1@audioblocks.test')!;
  const artist2 = seededUsers.find((u) => u.email === 'artist2@audioblocks.test')!;
  const electronicGenre = seededGenres.find((g) => g.name === 'Electronic')!;
  const hiphopGenre = seededGenres.find((g) => g.name === 'Hip-Hop')!;

  // 3. Seed Albums
  const albumDefinitions = [
    {
      title: 'Neon Horizons',
      artistId: artist1.id,
      artistAddress: artist1.walletAddress || '',
      coverArtPath: '/uploads/covers/neon-horizons.jpg',
      genre: 'Electronic',
      description: 'Debut electronic synthwave album by DJ Stellar.',
      songs: [] as string[],
    },
    {
      title: 'Stellar Grooves Vol. 1',
      artistId: artist2.id,
      artistAddress: artist2.walletAddress || '',
      coverArtPath: '/uploads/covers/stellar-grooves.jpg',
      genre: 'Hip-Hop',
      description: 'Lofi and boom-bap instrumental tracks by Luna Beats.',
      songs: [] as string[],
    },
  ];

  const seededAlbums: Album[] = [];
  for (const def of albumDefinitions) {
    let album = await albumRepo.findOne({ where: { title: def.title, artistId: def.artistId } });
    if (!album) {
      album = albumRepo.create(def);
      album = await albumRepo.save(album);
    }
    seededAlbums.push(album);
  }

  const album1 = seededAlbums[0];
  const album2 = seededAlbums[1];

  // 4. Seed Songs
  const songDefinitions = [
    {
      title: 'Cosmic Drift',
      artistId: artist1.id,
      artistAddress: artist1.walletAddress || '',
      genre: 'Electronic',
      genreId: electronicGenre.id,
      coverArtPath: '/uploads/covers/cosmic-drift.jpg',
      s3OriginalUrl: 'https://s3.audioblocks.test/audio/cosmic-drift.wav',
      hlsMasterUrl: 'https://cdn.audioblocks.test/hls/cosmic-drift/master.m3u8',
      description: 'High energy cosmic progressive track.',
    },
    {
      title: 'Night Drive in Cybercity',
      artistId: artist1.id,
      artistAddress: artist1.walletAddress || '',
      genre: 'Electronic',
      genreId: electronicGenre.id,
      coverArtPath: '/uploads/covers/night-drive.jpg',
      s3OriginalUrl: 'https://s3.audioblocks.test/audio/night-drive.wav',
      hlsMasterUrl: 'https://cdn.audioblocks.test/hls/night-drive/master.m3u8',
      description: 'Atmospheric midnight driving anthem.',
    },
    {
      title: 'Lunar Sunset',
      artistId: artist2.id,
      artistAddress: artist2.walletAddress || '',
      genre: 'Hip-Hop',
      genreId: hiphopGenre.id,
      coverArtPath: '/uploads/covers/lunar-sunset.jpg',
      s3OriginalUrl: 'https://s3.audioblocks.test/audio/lunar-sunset.wav',
      hlsMasterUrl: 'https://cdn.audioblocks.test/hls/lunar-sunset/master.m3u8',
      description: 'Mellow chillhop beats with vinyl dust.',
    },
  ];

  const seededSongs: Song[] = [];
  for (const def of songDefinitions) {
    let song = await songRepo.findOne({ where: { title: def.title, artistId: def.artistId } });
    if (!song) {
      song = songRepo.create(def);
      song = await songRepo.save(song);
    }
    seededSongs.push(song);
  }

  // Associate songs to album arrays if not already populated
  const album1Songs = seededSongs.filter((s) => s.artistId === artist1.id).map((s) => s.id);
  if (album1.songs.length === 0 && album1Songs.length > 0) {
    album1.songs = album1Songs;
    await albumRepo.save(album1);
  }

  const album2Songs = seededSongs.filter((s) => s.artistId === artist2.id).map((s) => s.id);
  if (album2.songs.length === 0 && album2Songs.length > 0) {
    album2.songs = album2Songs;
    await albumRepo.save(album2);
  }

  return {
    users: seededUsers,
    genres: seededGenres,
    albums: seededAlbums,
    songs: seededSongs,
  };
}

// If invoked directly from CLI (e.g. `ts-node src/seeders/test.seeder.ts` or `npm run seed:test`)
if (require.main === module) {
  (async () => {
    try {
      console.log('🚀 Seeding test database with users, songs, and albums...');
      const data = await seedTestDatabase();
      console.log(`✅ Test database seeded successfully!`);
      console.log(`   - Users:  ${data.users.length}`);
      console.log(`   - Genres: ${data.genres.length}`);
      console.log(`   - Albums: ${data.albums.length}`);
      console.log(`   - Songs:  ${data.songs.length}`);
      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to seed test database:', error);
      process.exit(1);
    }
  })();
}
