import { Readable } from 'stream';
import redis from '../config/redis';
import { CacheService } from '../services/CacheService';

jest.mock('../config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    unlink: jest.fn(),
    scanStream: jest.fn(),
  },
}));

jest.mock('../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('invalidatePattern (Issue #826)', () => {
    it('uses scanStream with count 500 and non-blocking unlink instead of keys/del', async () => {
      const chunk1 = ['stats:song:s1:30d', 'stats:song:s1:7d'];
      const chunk2 = ['stats:song:s1:all-time'];

      // Mock an async iterable stream like ioredis scanStream
      const mockStream = Readable.from([chunk1, chunk2]);
      (redis.scanStream as jest.Mock).mockReturnValue(mockStream);
      (redis.unlink as jest.Mock).mockResolvedValue(chunk1.length);

      await CacheService.invalidatePattern('stats:song:s1:*');

      expect(redis.scanStream).toHaveBeenCalledWith({
        match: 'stats:song:s1:*',
        count: 500,
      });

      expect(redis.unlink).toHaveBeenCalledWith(...chunk1);
      expect(redis.unlink).toHaveBeenCalledWith(...chunk2);
    });

    it('falls back to redis.del if redis.unlink is not available', async () => {
      const keys = ['song:123'];
      const mockStream = Readable.from([keys]);
      (redis.scanStream as jest.Mock).mockReturnValue(mockStream);
      const originalUnlink = redis.unlink;
      (redis as any).unlink = undefined;
      (redis.del as jest.Mock).mockResolvedValue(1);

      await CacheService.invalidatePattern('song:123');

      expect(redis.del).toHaveBeenCalledWith(...keys);

      (redis as any).unlink = originalUnlink;
    });

    it('handles empty scanStream gracefully without deleting anything', async () => {
      const mockStream = Readable.from([]);
      (redis.scanStream as jest.Mock).mockReturnValue(mockStream);

      await CacheService.invalidatePattern('nonexistent:*');

      expect(redis.scanStream).toHaveBeenCalledWith({
        match: 'nonexistent:*',
        count: 500,
      });
      expect(redis.unlink).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing', async () => {
      (redis.scanStream as jest.Mock).mockImplementation(() => {
        throw new Error('Redis connection failure');
      });

      await expect(CacheService.invalidatePattern('error:*')).resolves.not.toThrow();
    });
  });

  describe('basic get, set, and invalidate', () => {
    it('sets cache value with TTL in seconds', async () => {
      (redis.set as jest.Mock).mockResolvedValue('OK');
      await CacheService.set('test:key', { foo: 'bar' }, 60000);

      expect(redis.set).toHaveBeenCalledWith('test:key', JSON.stringify({ foo: 'bar' }), 'EX', 60);
    });

    it('gets and parses JSON from cache', async () => {
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify({ hello: 'world' }));
      const result = await CacheService.get<{ hello: string }>('test:key');

      expect(result).toEqual({ hello: 'world' });
    });

    it('invalidates a single key', async () => {
      (redis.del as jest.Mock).mockResolvedValue(1);
      await CacheService.invalidate('test:key');

      expect(redis.del).toHaveBeenCalledWith('test:key');
    });

    it('clears song cache using clearSong', async () => {
      (redis.del as jest.Mock).mockResolvedValue(1);
      await CacheService.clearSong('song-abc');

      expect(redis.del).toHaveBeenCalledWith('song:song-abc');
    });
  });
});
