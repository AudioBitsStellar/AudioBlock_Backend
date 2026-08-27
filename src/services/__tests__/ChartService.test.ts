import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

const cacheStore = new Map<string, unknown>();
jest.mock('../CacheService', () => ({
  CacheService: {
    get: jest.fn(async (key: string) => cacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, data: unknown) => {
      cacheStore.set(key, data);
    }),
    invalidatePattern: jest.fn(async () => undefined),
  },
}));

import AppDataSource from '../../config/db';
import { ChartService } from '../ChartService';
import { Song } from '../../entities/Song';
import { SongPlayEvent } from '../../entities/SongPlayEvent';

function makeEventRepoStub(rawMany: unknown[]) {
  const qb: any = {
    innerJoin: jest.fn(() => qb),
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    setParameter: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    having: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    limit: jest.fn(() => qb),
    getRawMany: jest.fn(async () => rawMany),
  };
  return { createQueryBuilder: jest.fn(() => qb), qb };
}

function makeSongRepoStub(songs: Partial<Song>[]) {
  return { findByIds: jest.fn(async () => songs) };
}

let eventRepo: ReturnType<typeof makeEventRepoStub>;
let songRepo: ReturnType<typeof makeSongRepoStub>;

function wireRepos() {
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === SongPlayEvent) return eventRepo;
    if (entity === Song) return songRepo;
    return songRepo;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheStore.clear();
  eventRepo = makeEventRepoStub([]);
  songRepo = makeSongRepoStub([]);
  wireRepos();
});

describe('ChartService.getTrending', () => {
  it('returns an empty list without error when no plays qualify', async () => {
    eventRepo = makeEventRepoStub([]);
    wireRepos();

    const result = await new ChartService().getTrending('7d', undefined, 20);

    expect(result).toEqual([]);
    expect(songRepo.findByIds).not.toHaveBeenCalled();
  });

  it('assigns stable, distinct ranks in query order even when scores tie', async () => {
    // Two rows share the same decayedScore — the DB query already ordered
    // them, so ranking must preserve that order (1, 2, ...) rather than
    // erroring or collapsing the tie into a single rank.
    eventRepo = makeEventRepoStub([
      { songId: 'song-1', playsInWindow: '10', decayedScore: '5.0' },
      { songId: 'song-2', playsInWindow: '10', decayedScore: '5.0' },
    ]);
    songRepo = makeSongRepoStub([
      { id: 'song-1', title: 'First', artistId: 'artist-1', genre: 'pop' },
      { id: 'song-2', title: 'Second', artistId: 'artist-2', genre: 'pop' },
    ]);
    wireRepos();

    const result = await new ChartService().getTrending('7d', undefined, 20);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ rank: 1, songId: 'song-1', trendingScore: 5 });
    expect(result[1]).toMatchObject({ rank: 2, songId: 'song-2', trendingScore: 5 });
  });

  it('skips a ranked row whose song record is missing rather than throwing', async () => {
    eventRepo = makeEventRepoStub([
      { songId: 'song-1', playsInWindow: '10', decayedScore: '5.0' },
      { songId: 'song-missing', playsInWindow: '8', decayedScore: '4.0' },
    ]);
    songRepo = makeSongRepoStub([
      { id: 'song-1', title: 'First', artistId: 'artist-1', genre: 'pop' },
    ]);
    wireRepos();

    const result = await new ChartService().getTrending('7d', undefined, 20);

    expect(result).toHaveLength(1);
    expect(result[0].songId).toBe('song-1');
  });

  it('caches results and serves the cached copy on a repeat call', async () => {
    eventRepo = makeEventRepoStub([{ songId: 'song-1', playsInWindow: '10', decayedScore: '5.0' }]);
    songRepo = makeSongRepoStub([
      { id: 'song-1', title: 'First', artistId: 'artist-1', genre: 'pop' },
    ]);
    wireRepos();

    const service = new ChartService();
    await service.getTrending('24h', undefined, 20);

    songRepo.findByIds.mockClear();
    const second = await service.getTrending('24h', undefined, 20);

    expect(second).toHaveLength(1);
    expect(songRepo.findByIds).not.toHaveBeenCalled();
  });
});
