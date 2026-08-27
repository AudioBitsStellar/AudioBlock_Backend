import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../services/CacheService', () => ({
  CacheService: {
    getGenreList: jest.fn(),
    cacheGenreList: jest.fn(),
    invalidateGenreList: jest.fn(),
  },
}));

import AppDataSource from '../config/db';
import { GenreService } from '../services/GenreService';
import { Genre } from '../entities/Genre';

const mockQueryBuilder = {
  leftJoin: jest.fn(),
  select: jest.fn(),
  addSelect: jest.fn(),
  groupBy: jest.fn(),
  addGroupBy: jest.fn(),
  orderBy: jest.fn(),
  getRawMany: jest.fn(),
};

const mockGenreRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockGenreRepo);
  // Chainable query builder
  for (const method of ['leftJoin', 'select', 'addSelect', 'groupBy', 'addGroupBy', 'orderBy']) {
    (mockQueryBuilder as any)[method].mockReturnValue(mockQueryBuilder);
  }
});

describe('GenreService.getGenresWithSongCounts', () => {
  it('returns genres with song counts from the grouped query', async () => {
    mockGenreRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.getRawMany.mockResolvedValue([
      { id: 'g1', name: 'Afrobeat', songCount: '12' },
      { id: 'g2', name: 'Jazz', songCount: '3' },
    ]);

    const svc = new GenreService();
    const result = await svc.getGenresWithSongCounts();

    expect(mockGenreRepo.createQueryBuilder).toHaveBeenCalledWith('genre');
    expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith('genre.songs', 'song');
    expect(result).toEqual([
      { id: 'g1', name: 'Afrobeat', songCount: 12 },
      { id: 'g2', name: 'Jazz', songCount: 3 },
    ]);
  });

  it('maps missing counts to zero', async () => {
    mockGenreRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.getRawMany.mockResolvedValue([{ id: 'g1', name: 'Empty', songCount: null }]);

    const svc = new GenreService();
    const result = await svc.getGenresWithSongCounts();

    expect(result[0].songCount).toBe(0);
  });
});

describe('GenreService.getGenreById', () => {
  it('looks up a genre by id', async () => {
    mockGenreRepo.findOneBy.mockResolvedValue({ id: 'g1', name: 'Pop' });

    const svc = new GenreService();
    const result = await svc.getGenreById('g1');

    expect(mockGenreRepo.findOneBy).toHaveBeenCalledWith({ id: 'g1' });
    expect(result).toMatchObject({ name: 'Pop' });
  });
});

describe('GenreService.createGenre', () => {
  it('creates and saves a genre', async () => {
    mockGenreRepo.create.mockImplementation((input: unknown) => input);
    mockGenreRepo.save.mockImplementation(async (g: Genre) => g);

    const svc = new GenreService();
    const result = await svc.createGenre('Amapiano');

    expect(mockGenreRepo.create).toHaveBeenCalledWith({ name: 'Amapiano' });
    expect(result).toMatchObject({ name: 'Amapiano' });
  });
});
