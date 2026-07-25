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

/**
 * Redis-backed cache for song streaming manifests, artist profiles, and genre
 * lists. Tracks cache hits/misses via Prometheus metrics.
 */
export class CacheService {
  /**
   * Retrieve a value from cache by key.
   *
   * @param key - The cache key to look up.
   * @returns Parsed cache data, or null on miss.
   */
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

  /**
   * Store a value in cache with a TTL.
   *
   * @param key - The cache key.
   * @param data - JSON-serializable data to store.
   * @param ttlMs - Time-to-live in milliseconds.
   */
  static async set(key: string, data: unknown, ttlMs: number): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(data), 'EX', ttlToSeconds(ttlMs));
    } catch (err) {
      logger.warn({ err, key }, 'Cache set failed');
    }
  }

  /**
   * Remove a single key from cache.
   *
   * @param key - The cache key to remove.
   */
  static async invalidate(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err) {
      logger.warn({ err, key }, 'Cache invalidate failed');
    }
  }

  /**
   * Remove all keys matching a Redis glob pattern.
   *
   * @param pattern - Redis key pattern (e.g. "song:*").
   */
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

  /**
   * Cache song streaming data (HLS manifest, presigned URLs).
   *
   * @param songId - The song's unique ID.
   * @param data - JSON-serializable data to cache.
   */
  static async cacheSong(songId: string, data: unknown): Promise<void> {
    await CacheService.set(`song:${songId}`, data, DEFAULT_TTL.song);
  }

  /**
   * Retrieve cached song streaming data.
   *
   * @param songId - The song's unique ID.
   * @returns Parsed cached data, or null on cache miss.
   */
  static async getSong<T>(songId: string): Promise<T | null> {
    return CacheService.get<T>(`song:${songId}`);
  }

  /**
   * Remove a song's cached streaming data.
   *
   * @param songId - The song's unique ID.
   */
  static async clearSong(songId: string): Promise<void> {
    await CacheService.invalidate(`song:${songId}`);
  }

  /**
   * Cache artist profile data.
   *
   * @param artistId - The artist's unique ID.
   * @param data - JSON-serializable artist profile data.
   */
  static async cacheArtist(artistId: string, data: unknown): Promise<void> {
    await CacheService.set(`artist:${artistId}`, data, DEFAULT_TTL.artist);
  }

  /**
   * Retrieve cached artist profile data.
   *
   * @param artistId - The artist's unique ID.
   * @returns Parsed cached data, or null on cache miss.
   */
  static async getArtist<T>(artistId: string): Promise<T | null> {
    return CacheService.get<T>(`artist:${artistId}`);
  }

  /**
   * Remove an artist's cached profile data.
   *
   * @param artistId - The artist's unique ID.
   */
  static async clearArtist(artistId: string): Promise<void> {
    await CacheService.invalidate(`artist:${artistId}`);
  }

  /**
   * Cache the full genre list.
   *
   * @param data - JSON-serializable genre list data.
   */
  static async cacheGenreList(data: unknown): Promise<void> {
    await CacheService.set('genres:all', data, DEFAULT_TTL.genre);
  }

  /**
   * Retrieve the cached genre list.
   *
   * @returns Parsed genre list, or null on cache miss.
   */
  static async getGenreList<T>(): Promise<T | null> {
    return CacheService.get<T>('genres:all');
  }

  /**
   * Remove the cached genre list.
   */
  static async invalidateGenreList(): Promise<void> {
    await CacheService.invalidate('genres:all');
  }
}
