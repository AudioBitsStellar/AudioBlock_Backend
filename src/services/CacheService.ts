import redis from '../config/redis';
import logger from '../config/logger';
import { cacheHitsTotal, cacheMissesTotal } from './MetricsService';

export interface CacheTTL {
  song: number;
  artist: number;
  genre: number;
}

const DEFAULT_TTL: CacheTTL = {
  song: Number(process.env.CACHE_TTL_SONG_MS || 300000),
  artist: Number(process.env.CACHE_TTL_ARTIST_MS || 600000),
  genre: Number(process.env.CACHE_TTL_GENRE_MS || 3600000),
};

function ttlToSeconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

export class CacheService {
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(key);
      if (cached) {
        cacheHitsTotal.inc();
        return JSON.parse(cached) as T;
      }
      cacheMissesTotal.inc();
      return null;
    } catch (err) {
      logger.warn({ err, key }, 'Cache get failed');
      cacheMissesTotal.inc();
      return null;
    }
  }

  static async set(key: string, data: unknown, ttlMs: number): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(data), 'EX', ttlToSeconds(ttlMs));
    } catch (err) {
      logger.warn({ err, key }, 'Cache set failed');
    }
  }

  static async invalidate(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err) {
      logger.warn({ err, key }, 'Cache invalidate failed');
    }
  }

  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info({ pattern, keyCount: keys.length }, 'Cache pattern invalidated');
      }
    } catch (err) {
      logger.warn({ err, pattern }, 'Cache pattern invalidate failed');
    }
  }

  static async cacheSong(songId: string, data: unknown): Promise<void> {
    await CacheService.set(`song:${songId}`, data, DEFAULT_TTL.song);
  }

  static async getSong<T>(songId: string): Promise<T | null> {
    return CacheService.get<T>(`song:${songId}`);
  }

  static async clearSong(songId: string): Promise<void> {
    await CacheService.invalidate(`song:${songId}`);
  }

  static async cacheArtist(artistId: string, data: unknown): Promise<void> {
    await CacheService.set(`artist:${artistId}`, data, DEFAULT_TTL.artist);
  }

  static async getArtist<T>(artistId: string): Promise<T | null> {
    return CacheService.get<T>(`artist:${artistId}`);
  }

  static async clearArtist(artistId: string): Promise<void> {
    await CacheService.invalidate(`artist:${artistId}`);
  }

  static async cacheGenreList(data: unknown): Promise<void> {
    await CacheService.set('genres:all', data, DEFAULT_TTL.genre);
  }

  static async getGenreList<T>(): Promise<T | null> {
    return CacheService.get<T>('genres:all');
  }

  static async invalidateGenreList(): Promise<void> {
    await CacheService.invalidate('genres:all');
  }
}
