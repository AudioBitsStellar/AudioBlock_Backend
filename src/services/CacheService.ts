import redis from "../config/redis";

export class CacheService {
  static async cacheSong(songId: string, data: any) {
    await redis.set(`song:${songId}`, JSON.stringify(data), "EX", 3600);
  }

  static async getSong(songId: string) {
    const cached = await redis.get(`song:${songId}`);
    return cached ? JSON.parse(cached) : null;
  }

  static async clearSong(songId: string) {
    await redis.del(`song:${songId}`);
  }
}
