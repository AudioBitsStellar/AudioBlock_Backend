import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/rabbitmq', () => ({
  getChannel: jest.fn().mockReturnValue({ sendToQueue: jest.fn() }),
}));
jest.mock('../config/s3', () => ({
  s3: {
    upload: jest
      .fn()
      .mockReturnValue({ promise: jest.fn().mockResolvedValue({ Location: 's3://bucket/key' }) }),
  },
}));
jest.mock('../services/Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
  stringArg: jest.fn((v) => v),
  u64Arg: jest.fn((v) => v),
}));
jest.mock('../config/soroban', () => ({
  SorobanContracts: { catalog: 'CATALOG_CONTRACT' },
  getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  getSorobanServer: jest.fn(),
  getSorobanRpcUrl: jest.fn(),
}));

import AppDataSource from '../config/db';
import { SongService } from '../services/SongService';
import { Song } from '../entities/Song';

const mockSongRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockSongRepo);
});

function makeSvc(): SongService {
  return new SongService();
}

const readySong = (overrides: Partial<Song> = {}): Song =>
  ({
    id: 's1',
    title: 'Sunrise',
    genreId: 'g1',
    status: 'ready',
    flagged: false,
    playCount: 10,
    user: { id: 'u1', username: 'artist', name: 'Artist', profileImage: null },
    ...overrides,
  }) as Song;

describe('SongService.getSongsByGenre', () => {
  it('returns enriched, paginated songs for a genre', async () => {
    mockSongRepo.findAndCount.mockResolvedValue([[readySong()], 1]);

    const svc = makeSvc();
    const result = await svc.getSongsByGenre('g1', 1, 20, 'newest');

    expect(mockSongRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { genreId: 'g1', status: 'ready', flagged: false },
        skip: 0,
        take: 20,
        order: { createdAt: 'DESC' },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.songs[0]).toMatchObject({
      id: 's1',
      title: 'Sunrise',
      genreId: 'g1',
      artist: { id: 'u1', username: 'artist' },
    });
  });

  it('sorts by most played when requested', async () => {
    mockSongRepo.findAndCount.mockResolvedValue([[readySong()], 1]);

    const svc = makeSvc();
    await svc.getSongsByGenre('g1', 1, 20, 'most_played');

    expect(mockSongRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ order: { playCount: 'DESC' } }),
    );
  });

  it('sorts alphabetically when requested', async () => {
    mockSongRepo.findAndCount.mockResolvedValue([[readySong()], 1]);

    const svc = makeSvc();
    await svc.getSongsByGenre('g1', 1, 20, 'alphabetical');

    expect(mockSongRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ order: { title: 'ASC' } }),
    );
  });

  it('falls back to newest for an unknown sort value', async () => {
    mockSongRepo.findAndCount.mockResolvedValue([[readySong()], 1]);

    const svc = makeSvc();
    await svc.getSongsByGenre('g1', 1, 20, 'bogus' as never);

    expect(mockSongRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'DESC' } }),
    );
  });

  it('clamps limit to 100 and computes total pages', async () => {
    mockSongRepo.findAndCount.mockResolvedValue([[readySong()], 250]);

    const svc = makeSvc();
    const result = await svc.getSongsByGenre('g1', 1, 500, 'newest');

    expect(mockSongRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(result.limit).toBe(100);
    expect(result.totalPages).toBe(3);
  });
});
