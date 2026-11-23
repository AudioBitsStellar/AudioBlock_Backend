import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import { SongPlayEvent } from '../entities/SongPlayEvent';
import { SongSave } from '../entities/SongSave';
import { RoyaltyPayout } from '../entities/RoyaltyPayout';
import {
  ARTIST_ANALYTICS_EXPORT_MAX_SONGS,
  ArtistAnalyticsExportService,
} from '../services/Song/ArtistAnalyticsExportService';

const artistId = '12121212-1212-4212-8212-121212121212';

const mockSongRepo = { find: jest.fn() };
let playRows: unknown[] = [];
let saveRows: unknown[] = [];
let payoutRows: unknown[] = [];

/** A query builder stub whose terminal call resolves to the rows for its table. */
function queryBuilderReturning(getRows: () => unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn(async () => getRows());
  return qb;
}

const playQb = queryBuilderReturning(() => playRows);
const saveQb = queryBuilderReturning(() => saveRows);
const payoutQb = queryBuilderReturning(() => payoutRows);

beforeEach(() => {
  jest.clearAllMocks();
  playRows = [];
  saveRows = [];
  payoutRows = [];
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === Song) return mockSongRepo;
    if (entity === SongPlayEvent) return { createQueryBuilder: () => playQb };
    if (entity === SongSave) return { createQueryBuilder: () => saveQb };
    if (entity === RoyaltyPayout) return { createQueryBuilder: () => payoutQb };
    return mockSongRepo;
  });
});

describe('ArtistAnalyticsExportService.buildCsv (#982)', () => {
  it('returns only the header for an artist with no songs', async () => {
    mockSongRepo.find.mockResolvedValueOnce([]);
    const service = new ArtistAnalyticsExportService();

    const csv = await service.buildCsv(artistId, '30d');

    expect(csv).toBe('Song ID,Title,Plays,Saves,Gross revenue (stroops)\r\n');
    expect(playQb.getRawMany).not.toHaveBeenCalled();
  });

  it('writes one row per song, with zeros where a song had no activity', async () => {
    mockSongRepo.find.mockResolvedValueOnce([
      { id: 'song-a', title: 'Alpha' },
      { id: 'song-b', title: 'Beta, Live' },
    ]);
    playRows = [{ songId: 'song-a', value: '7' }];
    saveRows = [{ songId: 'song-a', value: '2' }];
    payoutRows = [{ songId: 'song-a', value: '5000000' }];
    const service = new ArtistAnalyticsExportService();

    const csv = await service.buildCsv(artistId, '7d');

    expect(csv).toBe(
      [
        'Song ID,Title,Plays,Saves,Gross revenue (stroops)',
        'song-a,Alpha,7,2,5000000',
        'song-b,"Beta, Live",0,0,0',
        '',
      ].join('\r\n'),
    );
  });

  it('keeps the revenue as a string so large totals are not rounded', async () => {
    mockSongRepo.find.mockResolvedValueOnce([{ id: 'song-a', title: 'Alpha' }]);
    payoutRows = [{ songId: 'song-a', value: '9007199254740993' }];
    const service = new ArtistAnalyticsExportService();

    const csv = await service.buildCsv(artistId, 'all-time');

    expect(csv).toContain('song-a,Alpha,0,0,9007199254740993');
  });

  it('escapes a song title that would otherwise run as a spreadsheet formula', async () => {
    mockSongRepo.find.mockResolvedValueOnce([{ id: 'song-a', title: '=1+1' }]);
    const service = new ArtistAnalyticsExportService();

    const csv = await service.buildCsv(artistId, '30d');

    expect(csv).toContain("song-a,'=1+1,0,0,0");
  });

  it('refuses a catalogue above the size limit instead of truncating it', async () => {
    const tooMany = Array.from({ length: ARTIST_ANALYTICS_EXPORT_MAX_SONGS + 1 }, (_, i) => ({
      id: `song-${i}`,
      title: `Track ${i}`,
    }));
    mockSongRepo.find.mockResolvedValueOnce(tooMany);
    const service = new ArtistAnalyticsExportService();

    await expect(service.buildCsv(artistId, '30d')).rejects.toMatchObject({
      statusCode: 413,
      code: 'EXPORT_TOO_LARGE',
    });
    expect(playQb.getRawMany).not.toHaveBeenCalled();
  });

  it('loads at most one song more than the limit to detect an oversized catalogue', async () => {
    mockSongRepo.find.mockResolvedValueOnce([]);
    const service = new ArtistAnalyticsExportService();

    await service.buildCsv(artistId, '30d');

    expect(mockSongRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artistId },
        take: ARTIST_ANALYTICS_EXPORT_MAX_SONGS + 1,
      }),
    );
  });
});
