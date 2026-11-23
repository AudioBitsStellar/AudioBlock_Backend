import { Repository, SelectQueryBuilder } from 'typeorm';
import AppDataSource from '../../config/db';
import { Song } from '../../entities/Song';
import { SongPlayEvent } from '../../entities/SongPlayEvent';
import { SongSave } from '../../entities/SongSave';
import { RoyaltyPayout, RoyaltyPayoutStatus } from '../../entities/RoyaltyPayout';
import { AppError, ErrorType } from '../../errors/AppError';
import { toCsv } from '../../utils/csv';
import { resolvePeriod, StatsWindow } from './SongStatsService';

/**
 * Largest catalogue an export will cover (#982). An artist above this is refused
 * with 413 rather than given a silently partial file.
 */
export const ARTIST_ANALYTICS_EXPORT_MAX_SONGS = 1000;

const CSV_HEADERS = ['Song ID', 'Title', 'Plays', 'Saves', 'Gross revenue (stroops)'];

interface GroupedRow {
  songId: string;
  value: string | number | null;
}

/** Start (inclusive, or null for all-time) and end (exclusive) of a window. */
interface Bounds {
  start: Date | null;
  end: Date;
}

/** Applies the window's bounds to a query on a timestamp column. */
function withinBounds<T extends object>(
  qb: SelectQueryBuilder<T>,
  column: string,
  bounds: Bounds,
): SelectQueryBuilder<T> {
  qb.andWhere(`${column} < :end`, { end: bounds.end });
  if (bounds.start) qb.andWhere(`${column} >= :start`, { start: bounds.start });
  return qb;
}

/**
 * Per-song analytics for an artist's catalogue, rendered as CSV (#982).
 *
 * Figures match the artist overview in SongStatsService: plays and saves are
 * counted in the window, and revenue is gross song revenue from reconciled
 * payouts. Songs with no activity in the window still get a row, with zeros.
 */
export class ArtistAnalyticsExportService {
  private songRepo: Repository<Song>;
  private playRepo: Repository<SongPlayEvent>;
  private saveRepo: Repository<SongSave>;
  private payoutRepo: Repository<RoyaltyPayout>;

  constructor() {
    this.songRepo = AppDataSource.getRepository(Song);
    this.playRepo = AppDataSource.getRepository(SongPlayEvent);
    this.saveRepo = AppDataSource.getRepository(SongSave);
    this.payoutRepo = AppDataSource.getRepository(RoyaltyPayout);
  }

  /**
   * Build the CSV for every song the artist owns, ordered by title.
   *
   * @param artistId - The artist whose catalogue is exported.
   * @param window - One of 7d / 30d / 90d / all-time.
   * @throws {AppError} 413 when the artist owns more than ARTIST_ANALYTICS_EXPORT_MAX_SONGS songs.
   */
  async buildCsv(artistId: string, window: StatsWindow): Promise<string> {
    // Load one song more than the limit, so an oversized catalogue is detected
    // without reading all of it.
    const songs = await this.songRepo.find({
      where: { artistId },
      select: ['id', 'title'],
      order: { title: 'ASC' },
      take: ARTIST_ANALYTICS_EXPORT_MAX_SONGS + 1,
    });
    if (songs.length > ARTIST_ANALYTICS_EXPORT_MAX_SONGS) {
      throw new AppError(
        `Exports are limited to ${ARTIST_ANALYTICS_EXPORT_MAX_SONGS} songs. Contact support for a larger export.`,
        ErrorType.VALIDATION_FAILED,
        413,
        true,
        undefined,
        'EXPORT_TOO_LARGE',
      );
    }
    if (songs.length === 0) return toCsv(CSV_HEADERS, []);

    const period = resolvePeriod(window, new Date());
    const bounds: Bounds = { start: period.start, end: period.end };
    const songIds = songs.map((song) => song.id);
    const [plays, saves, revenue] = await Promise.all([
      this.countPlays(songIds, bounds),
      this.countSaves(songIds, bounds),
      this.sumRevenue(songIds, bounds),
    ]);

    const rows = songs.map((song) => [
      song.id,
      song.title,
      plays.get(song.id) ?? 0,
      saves.get(song.id) ?? 0,
      revenue.get(song.id) ?? '0',
    ]);
    return toCsv(CSV_HEADERS, rows);
  }

  private async countPlays(songIds: string[], bounds: Bounds): Promise<Map<string, number>> {
    const qb = this.playRepo
      .createQueryBuilder('play')
      .select('play.songId', 'songId')
      .addSelect('COUNT(*)', 'value')
      .where('play.songId IN (:...songIds)', { songIds })
      .groupBy('play.songId');
    withinBounds(qb, 'play.playedAt', bounds);

    const rows = await qb.getRawMany<GroupedRow>();
    return new Map(rows.map((row) => [row.songId, Number(row.value ?? 0)]));
  }

  private async countSaves(songIds: string[], bounds: Bounds): Promise<Map<string, number>> {
    const qb = this.saveRepo
      .createQueryBuilder('save')
      .select('save.songId', 'songId')
      .addSelect('COUNT(*)', 'value')
      .where('save.songId IN (:...songIds)', { songIds })
      .groupBy('save.songId');
    withinBounds(qb, 'save.savedAt', bounds);

    const rows = await qb.getRawMany<GroupedRow>();
    return new Map(rows.map((row) => [row.songId, Number(row.value ?? 0)]));
  }

  /**
   * Gross revenue in stroops per song, from reconciled payouts only. Returned as
   * strings so large totals never lose precision through a JS number.
   */
  private async sumRevenue(songIds: string[], bounds: Bounds): Promise<Map<string, string>> {
    const qb = this.payoutRepo
      .createQueryBuilder('payout')
      .select('payout.songId', 'songId')
      .addSelect('COALESCE(SUM(payout.grossAmount), 0)', 'value')
      .where('payout.songId IN (:...songIds)', { songIds })
      .andWhere('payout.status = :status', { status: RoyaltyPayoutStatus.RECONCILED })
      .groupBy('payout.songId');
    withinBounds(qb, 'payout.createdAt', bounds);

    const rows = await qb.getRawMany<GroupedRow>();
    return new Map(rows.map((row) => [row.songId, String(row.value ?? 0)]));
  }
}
