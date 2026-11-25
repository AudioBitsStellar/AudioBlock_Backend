/* eslint-disable max-lines, max-lines-per-function */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import AppDataSource from '../../config/db';
import redis from '../../config/redis';
import {
  precomputeSignedManifest,
  rewriteManifest,
  s3KeyFromUrl,
  getSignedUrl,
  getManifestCacheTtl,
  getSignedUrlExpiry,
  ManifestNotFoundError,
  DEFAULT_MANIFEST_CACHE_TTL,
  DEFAULT_SIGNED_URL_EXPIRES,
  CACHE_TTL,
  SIGNED_EXPIRES,
} from '../precomputeManifest';

// Access the shared send mock from the @aws-sdk/client-s3 mock
const s3Module = jest.requireMock('@aws-sdk/client-s3') as {
  __mockSend: jest.Mock;
};

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
  },
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  return {
    S3Client: jest.fn(() => ({ send })),
    GetObjectCommand: jest.fn(
      (input: { Bucket: string; Key: string }) => ({ input }),
    ),
    PutObjectCommand: jest.fn(),
    __esModule: true,
    __mockSend: send,
  };
});

describe('precomputeManifest (#828)', () => {
  let mockSend: jest.Mock;
  let mockSongRepo: {
    findOneBy: jest.Mock;
  };
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_BUCKET_NAME: 'test-audio-bucket',
    };

    mockSend = s3Module.__mockSend;

    (awsGetSignedUrl as jest.Mock).mockImplementation(
      async (
        _client: unknown,
        command: { input: { Bucket: string; Key: string } },
        options?: { expiresIn: number },
      ) => {
        const expires = options?.expiresIn ?? 600;
        return `https://${command.input.Bucket}.s3.amazonaws.com/${command.input.Key}?signed=true&expires=${expires}`;
      },
    );

    mockSongRepo = {
      findOneBy: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockSongRepo);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('TTL vs Signed URL Expiry Relationship', () => {
    it('asserts default signed URL expiry exceeds cache TTL', () => {
      delete process.env.MANIFEST_CACHE_TTL;
      delete process.env.SIGNED_URL_EXPIRES;

      const cacheTtl = getManifestCacheTtl();
      const signedExpiry = getSignedUrlExpiry();

      expect(signedExpiry).toBeGreaterThan(cacheTtl);
      expect(DEFAULT_SIGNED_URL_EXPIRES).toBeGreaterThan(DEFAULT_MANIFEST_CACHE_TTL);
      expect(SIGNED_EXPIRES).toBeGreaterThanOrEqual(CACHE_TTL);
    });

    it('enforces signed URL expiry exceeds cache TTL even if configured lower in environment', () => {
      process.env.MANIFEST_CACHE_TTL = '500';
      process.env.SIGNED_URL_EXPIRES = '300'; // Misconfiguration: expiry <= cache TTL

      const cacheTtl = getManifestCacheTtl();
      const signedExpiry = getSignedUrlExpiry();

      // Must be automatically adjusted so cached manifests never contain expired segment URLs
      expect(signedExpiry).toBeGreaterThan(cacheTtl);
      expect(signedExpiry).toBe(cacheTtl + 300);
    });

    it('respects valid configured expiry exceeding cache TTL', () => {
      process.env.MANIFEST_CACHE_TTL = '300';
      process.env.SIGNED_URL_EXPIRES = '900';

      expect(getManifestCacheTtl()).toBe(300);
      expect(getSignedUrlExpiry()).toBe(900);
      expect(getSignedUrlExpiry()).toBeGreaterThan(getManifestCacheTtl());
    });
  });

  describe('Single Media Playlist Handling', () => {
    const singleMediaManifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '',
      '#EXTINF:10.000,',
      'segment000.ts',
      '#EXTINF:10.000,',
      'segment001.ts',
      '#EXTINF:5.500,',
      './segment002.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    it('preserves comment and tag lines unchanged and rewrites every segment line to a signed URL', async () => {
      const songId = 'song-123';
      const rewritten = await rewriteManifest(singleMediaManifest, songId);
      const lines = rewritten.split('\n');

      expect(lines[0]).toBe('#EXTM3U');
      expect(lines[1]).toBe('#EXT-X-VERSION:3');
      expect(lines[2]).toBe('#EXT-X-TARGETDURATION:10');
      expect(lines[3]).toBe('#EXT-X-MEDIA-SEQUENCE:0');
      expect(lines[4]).toBe('');
      expect(lines[5]).toBe('#EXTINF:10.000,');
      expect(lines[6]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-123/hls/segment000.ts?signed=true&expires=600',
      );
      expect(lines[7]).toBe('#EXTINF:10.000,');
      expect(lines[8]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-123/hls/segment001.ts?signed=true&expires=600',
      );
      expect(lines[9]).toBe('#EXTINF:5.500,');
      expect(lines[10]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-123/hls/segment002.ts?signed=true&expires=600',
      );
      expect(lines[11]).toBe('#EXT-X-ENDLIST');

      expect(awsGetSignedUrl).toHaveBeenCalledTimes(3);
    });

    it('matches snapshot for a representative single media manifest', async () => {
      const songId = 'song-snapshot-test';
      const rewritten = await rewriteManifest(singleMediaManifest, songId);
      expect(rewritten).toMatchSnapshot();
    });
  });

  describe('Master Playlist with Variants Handling (ABR ladder support)', () => {
    const masterPlaylist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
      '128k/prog_index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=256000,CODECS="mp4a.40.2"',
      '256k/prog_index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=320000,CODECS="mp4a.40.2"',
      'variant_high.m3u8',
    ].join('\n');

    it('rewrites nested variant playlist lines while preserving variant tags unchanged', async () => {
      const songId = 'song-abr-456';
      const rewritten = await rewriteManifest(masterPlaylist, songId);
      const lines = rewritten.split('\n');

      expect(lines[0]).toBe('#EXTM3U');
      expect(lines[1]).toBe('#EXT-X-VERSION:3');
      expect(lines[2]).toBe('#EXT-X-INDEPENDENT-SEGMENTS');
      expect(lines[3]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"');
      expect(lines[4]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-abr-456/hls/128k/prog_index.m3u8?signed=true&expires=600',
      );
      expect(lines[5]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=256000,CODECS="mp4a.40.2"');
      expect(lines[6]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-abr-456/hls/256k/prog_index.m3u8?signed=true&expires=600',
      );
      expect(lines[7]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=320000,CODECS="mp4a.40.2"');
      expect(lines[8]).toBe(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-abr-456/hls/variant_high.m3u8?signed=true&expires=600',
      );

      expect(awsGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            Key: 'songs/song-abr-456/hls/128k/prog_index.m3u8',
          }),
        }),
        expect.any(Object),
      );
    });

    it('matches snapshot for a representative master playlist with variants', async () => {
      const songId = 'song-abr-snapshot';
      const rewritten = await rewriteManifest(masterPlaylist, songId);
      expect(rewritten).toMatchSnapshot();
    });
  });

  describe('precomputeSignedManifest execution and Redis caching', () => {
    it('fetches source manifest from S3, rewrites, caches in Redis, and returns the signed manifest', async () => {
      const songId = 'song-full-flow';
      mockSongRepo.findOneBy.mockResolvedValue({
        id: songId,
        hlsMasterUrl:
          'https://test-audio-bucket.s3.amazonaws.com/songs/song-full-flow/hls/master.m3u8',
      });

      const s3ManifestContent = '#EXTM3U\n#EXTINF:10.0,\nsegment0.ts\n#EXT-X-ENDLIST';
      mockSend.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(s3ManifestContent),
        },
      });

      const result = await precomputeSignedManifest(songId);

      expect(mockSongRepo.findOneBy).toHaveBeenCalledWith({ id: songId });
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-audio-bucket',
        Key: 'songs/song-full-flow/hls/master.m3u8',
      });
      expect(redis.setex).toHaveBeenCalledWith(`manifest:${songId}`, 300, result);
      expect(result).toContain(
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-full-flow/hls/segment0.ts',
      );
    });

    it('handles lines that already contain absolute URLs or songs/ key prefixes', async () => {
      const songId = 'song-urls';
      const manifestWithUrls = [
        '#EXTM3U',
        'https://test-audio-bucket.s3.amazonaws.com/songs/song-urls/hls/segment0.ts',
        'songs/song-urls/hls/segment1.ts',
        './songs/song-urls/hls/segment2.ts',
      ].join('\n');

      const rewritten = await rewriteManifest(manifestWithUrls, songId);
      const lines = rewritten.split('\n');

      expect(lines[1]).toContain('songs/song-urls/hls/segment0.ts');
      expect(lines[2]).toContain('songs/song-urls/hls/segment1.ts');
      expect(lines[3]).toContain('songs/song-urls/hls/segment2.ts');
    });
  });

  describe('Missing source manifest error handling (typed error, not crash)', () => {
    it('throws ManifestNotFoundError when song does not exist in database', async () => {
      mockSongRepo.findOneBy.mockResolvedValue(null);

      await expect(precomputeSignedManifest('non-existent-id')).rejects.toThrow(
        ManifestNotFoundError,
      );
      await expect(precomputeSignedManifest('non-existent-id')).rejects.toThrow(
        'No HLS manifest for song non-existent-id',
      );
    });

    it('throws ManifestNotFoundError when song has no hlsMasterUrl', async () => {
      mockSongRepo.findOneBy.mockResolvedValue({
        id: 'no-hls-id',
        hlsMasterUrl: null,
      });

      await expect(precomputeSignedManifest('no-hls-id')).rejects.toThrow(ManifestNotFoundError);
    });

    it('throws ManifestNotFoundError when S3 getObject throws NoSuchKey or 404', async () => {
      mockSongRepo.findOneBy.mockResolvedValue({
        id: 's3-missing-id',
        hlsMasterUrl:
          'https://test-audio-bucket.s3.amazonaws.com/songs/s3-missing-id/hls/master.m3u8',
      });

      const s3Error = Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
      });
      mockSend.mockRejectedValue(s3Error);

      await expect(precomputeSignedManifest('s3-missing-id')).rejects.toThrow(
        ManifestNotFoundError,
      );
      await expect(precomputeSignedManifest('s3-missing-id')).rejects.toThrow(
        'Source manifest not found in storage',
      );
    });

    it('throws ManifestNotFoundError when S3 returns an empty body', async () => {
      mockSongRepo.findOneBy.mockResolvedValue({
        id: 'empty-body-id',
        hlsMasterUrl:
          'https://test-audio-bucket.s3.amazonaws.com/songs/empty-body-id/hls/master.m3u8',
      });

      mockSend.mockResolvedValue({
        Body: null,
      });

      await expect(precomputeSignedManifest('empty-body-id')).rejects.toThrow(
        ManifestNotFoundError,
      );
      await expect(precomputeSignedManifest('empty-body-id')).rejects.toThrow(
        'Empty manifest retrieved for song empty-body-id',
      );
    });
  });

  describe('s3KeyFromUrl utility', () => {
    it('correctly extracts key from standard S3 URL', () => {
      const url = 'https://my-bucket.s3.eu-west-1.amazonaws.com/songs/song-999/hls/master.m3u8';
      expect(s3KeyFromUrl(url)).toBe('songs/song-999/hls/master.m3u8');
    });

    it('correctly extracts key from custom domain S3 URL', () => {
      const url = 'https://cdn.audioblocks.com/songs/song-999/hls/master.m3u8';
      expect(s3KeyFromUrl(url)).toBe('songs/song-999/hls/master.m3u8');
    });

    it('throws ManifestNotFoundError for invalid URL format', () => {
      expect(() => s3KeyFromUrl('')).toThrow(ManifestNotFoundError);
      expect(() => s3KeyFromUrl('not-a-url')).toThrow(ManifestNotFoundError);
    });
  });

  describe('getSignedUrl helper', () => {
    it('calls presigned URL helper with configured parameters', async () => {
      const url = await getSignedUrl('songs/1/hls/file.ts', 450);
      expect(url).toContain('songs/1/hls/file.ts');
      expect(url).toContain('expires=450');
      expect(awsGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-audio-bucket',
            Key: 'songs/1/hls/file.ts',
          }),
        }),
        expect.objectContaining({ expiresIn: 450 }),
      );
    });
  });
});
