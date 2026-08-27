import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import { SongPlayEvent } from '../entities/SongPlayEvent';
import { CacheService } from './CacheService';

export type ChartWindow = '24h' | '7d' | '30d';

const WINDOW_HOURS: Record<ChartWindow, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

const MIN_PLAYS_TO_QUALIFY = Number(process.env.CHART_MIN_PLAYS || 5);
const CHART_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface TrendingEntry {
  rank: number;
  songId: string;
  title: string;
  artistId: string;
  genre: string | null;
  playsInWindow: number;
  trendingScore: number;
}

/**
 * Ranks songs by play velocity (plays/hour) with exponential recency decay,
 * rather than raw total play count, so newly rising songs can surface.
 */
export class ChartService {
  private songRepo: Repository<Song>;

  constructor() {
    this.songRepo = AppDataSource.getRepository(Song);
  }

  async getTrending(window: ChartWindow, genre?: string, limit = 20): Promise<TrendingEntry[]> {
    const cacheKey = `charts:trending:${window}:${genre || 'all'}:${limit}`;
    const cached = await CacheService.get<TrendingEntry[]>(cacheKey);
    if (cached) return cached;

    const entries = await this.computeTrending(window, genre, limit);
    await CacheService.set(cacheKey, entries, CHART_CACHE_TTL_MS);
    return entries;
  }

  private async computeTrending(
    window: ChartWindow,
    genre: string | undefined,
    limit: number,
  ): Promise<TrendingEntry[]> {
    const hours = WINDOW_HOURS[window];
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const eventRepo = AppDataSource.getRepository(SongPlayEvent);
    const qb = eventRepo
      .createQueryBuilder('event')
      .innerJoin(Song, 'song', 'song.id = event.songId')
      .select('event.songId', 'songId')
      .addSelect('COUNT(*)', 'playsInWindow')
      .addSelect(
        `SUM(EXP(-EXTRACT(EPOCH FROM (:now - event.playedAt)) / :decayConstant))`,
        'decayedScore',
      )
      .where('event.playedAt >= :since', { since })
      .andWhere('song.status = :status', { status: 'ready' })
      .andWhere('song.flagged = false')
      .setParameter('now', new Date())
      .setParameter('decayConstant', hours * 3600)
      .groupBy('event.songId')
      .having('COUNT(*) >= :minPlays', { minPlays: MIN_PLAYS_TO_QUALIFY });

    if (genre) {
      qb.andWhere('song.genre = :genre', { genre });
    }

    const rows = await qb
      .orderBy('"decayedScore"', 'DESC')
      .limit(limit)
      .getRawMany<{ songId: string; playsInWindow: string; decayedScore: string }>();

    if (rows.length === 0) return [];

    const songs = await this.songRepo.findByIds(rows.map((r) => r.songId));
    const songById = new Map(songs.map((s) => [s.id, s]));

    const entries: TrendingEntry[] = [];
    rows.forEach((row, index) => {
      const song = songById.get(row.songId);
      if (!song) return;
      entries.push({
        rank: index + 1,
        songId: song.id,
        title: song.title,
        artistId: song.artistId,
        genre: song.genre ?? null,
        playsInWindow: Number(row.playsInWindow),
        trendingScore: Number(row.decayedScore),
      });
    });
    return entries;
  }
}
