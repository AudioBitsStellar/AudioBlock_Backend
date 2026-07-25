import redis from "../config/redis";
import { cacheHitsTotal, cacheMissesTotal } from "./MetricsService";

export class CacheService {
  static async cacheSong(songId: string, data: any) {
    await redis.set(`song:${songId}`, JSON.stringify(data), "EX", 3600);
  }

  static async getSong(songId: string) {
    const cached = await redis.get(`song:${songId}`);
    if (cached) {
      cacheHitsTotal.inc();
      return JSON.parse(cached);
    }
    cacheMissesTotal.inc();
    return null;
  }

  static async clearSong(songId: string) {
    await redis.del(`song:${songId}`);
  }
}
