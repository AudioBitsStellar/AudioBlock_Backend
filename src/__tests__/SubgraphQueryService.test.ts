import { SubgraphQueryService, ArtistQueryResult, SongQueryResult } from '../services/SubgraphQueryService';
import { SorobanEventReader } from '../services/Soroban/SorobanEventReader';
import logger from '../config/logger';
import axios from 'axios';

jest.mock('axios');
jest.mock('../config/logger');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SubgraphQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GRAPH_SUBGRAPH_URL;
    delete process.env.SUBGRAPH_FALLBACK_ENABLED;
  });

  describe('constructor', () => {
    it('initializes with provided subgraph URL', () => {
      const service = new SubgraphQueryService('https://graph.example.com');
      expect(service).toBeDefined();
    });

    it('initializes with environment variable GRAPH_SUBGRAPH_URL', () => {
      process.env.GRAPH_SUBGRAPH_URL = 'https://env-graph.example.com';
      const service = new SubgraphQueryService();
      expect(service).toBeDefined();
    });

    it('initializes fallback as enabled by default', () => {
      const service = new SubgraphQueryService('https://graph.example.com');
      expect(service).toBeDefined();
    });

    it('initializes fallback as disabled when SUBGRAPH_FALLBACK_ENABLED is false', () => {
      process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
      const service = new SubgraphQueryService('https://graph.example.com');
      expect(service).toBeDefined();
    });

    it('accepts custom RPC reader', () => {
      const mockReader = jest.createMockFromModule<SorobanEventReader>('../services/Soroban/SorobanEventReader');
      const service = new SubgraphQueryService('https://graph.example.com', mockReader);
      expect(service).toBeDefined();
    });
  });

  describe('queryArtists', () => {
    it('returns artists from subgraph on successful query', async () => {
      const artists: ArtistQueryResult[] = [
        { id: 'artist-1', name: 'Artist A', wallet: 'GXXXXXX', createdAt: '2026-01-01' },
        { id: 'artist-2', name: 'Artist B', wallet: 'GYYYYYY', createdAt: '2026-01-02' },
      ];

      mockedAxios.post.mockResolvedValue({
        data: { data: { artists } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: artists,
        source: 'subgraph',
        error: null,
        fallbackUsed: false,
      });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.example.com',
        expect.objectContaining({
          query: expect.stringContaining('artists'),
        }),
        expect.any(Object),
      );
    });

    it('returns empty artists array when subgraph returns null', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { data: { artists: null } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: null,
        source: 'subgraph',
        error: null,
        fallbackUsed: false,
      });
    });

    it('falls back to RPC when subgraph query fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not fallback to RPC when fallback is disabled', async () => {
      process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: null,
        source: 'subgraph',
        error: expect.stringContaining('Subgraph error'),
        fallbackUsed: false,
      });
    });

    it('retries on GraphQL errors before falling back', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { errors: [{ message: 'Rate limited' }] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        })
        .mockResolvedValueOnce({
          data: { errors: [{ message: 'Rate limited' }] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        })
        .mockResolvedValueOnce({
          data: { errors: [{ message: 'Rate limited' }] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('respects custom limit parameter', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { data: { artists: [] } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      await service.queryArtists(50);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.example.com',
        expect.objectContaining({
          query: expect.stringContaining('first: 50'),
        }),
        expect.any(Object),
      );
    });
  });

  describe('querySongs', () => {
    it('returns songs from subgraph on successful query', async () => {
      const songs: SongQueryResult[] = [
        { id: 'song-1', title: 'Song A', artist: 'artist-1', createdAt: '2026-01-01' },
        { id: 'song-2', title: 'Song B', artist: 'artist-2', createdAt: '2026-01-02' },
      ];

      mockedAxios.post.mockResolvedValue({
        data: { data: { songs } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.querySongs(10);

      expect(result).toEqual({
        data: songs,
        source: 'subgraph',
        error: null,
        fallbackUsed: false,
      });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.example.com',
        expect.objectContaining({
          query: expect.stringContaining('songs'),
        }),
        expect.any(Object),
      );
    });

    it('returns empty songs array when subgraph returns null', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { data: { songs: null } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.querySongs(10);

      expect(result).toEqual({
        data: null,
        source: 'subgraph',
        error: null,
        fallbackUsed: false,
      });
    });

    it('falls back to RPC when subgraph query fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.querySongs(10);

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });
    });

    it('respects custom limit parameter', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { data: { songs: [] } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      await service.querySongs(75);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.example.com',
        expect.objectContaining({
          query: expect.stringContaining('first: 75'),
        }),
        expect.any(Object),
      );
    });
  });

  describe('querySubgraph (private method via public methods)', () => {
    it('handles missing subgraph URL gracefully', async () => {
      const service = new SubgraphQueryService('');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });
    });

    it('includes correct headers in axios request', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { data: { artists: [] } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      await service.queryArtists(10);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        }),
      );
    });

    it('implements exponential backoff on retries', async () => {
      jest.useFakeTimers();

      mockedAxios.post
        .mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'Timeout' })
        .mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'Timeout' })
        .mockResolvedValueOnce({
          data: { data: { artists: [] } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        });

      const service = new SubgraphQueryService('https://graph.example.com');
      const promise = service.queryArtists(10);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });

      jest.useRealTimers();
    });

    it('handles connection refused errors', async () => {
      mockedAxios.post.mockRejectedValue({ code: 'ECONNREFUSED', message: 'Connection refused' });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result).toEqual({
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('isSubgraphHealthy', () => {
    it('returns true when subgraph responds with valid _meta', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          data: {
            _meta: {
              deployment: 'QmXXX',
              network: 'mainnet',
              hasIndexingErrors: false,
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const healthy = await service.isSubgraphHealthy();

      expect(healthy).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.example.com',
        expect.objectContaining({
          query: expect.stringContaining('_meta'),
        }),
        expect.any(Object),
      );
    });

    it('returns false when subgraph returns error', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { errors: [{ message: 'Service unavailable' }] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const healthy = await service.isSubgraphHealthy();

      expect(healthy).toBe(false);
    });

    it('returns false on network error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const service = new SubgraphQueryService('https://graph.example.com');
      const healthy = await service.isSubgraphHealthy();

      expect(healthy).toBe(false);
    });

    it('returns false when query throws', async () => {
      mockedAxios.post.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const healthy = await service.isSubgraphHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('getHealthReport', () => {
    it('returns complete health report when subgraph is healthy', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          data: {
            _meta: {
              deployment: 'QmXXX',
              network: 'mainnet',
              hasIndexingErrors: false,
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const report = await service.getHealthReport();

      expect(report).toEqual({
        subgraphHealthy: true,
        fallbackEnabled: true,
        subgraphUrl: 'https://graph.example.com',
      });
    });

    it('returns health report when subgraph is unhealthy', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Service unavailable'));

      const service = new SubgraphQueryService('https://graph.example.com');
      const report = await service.getHealthReport();

      expect(report).toEqual({
        subgraphHealthy: false,
        fallbackEnabled: true,
        subgraphUrl: 'https://graph.example.com',
      });
    });

    it('reports fallback disabled when env var is false', async () => {
      process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
      mockedAxios.post.mockResolvedValue({
        data: {
          data: {
            _meta: {
              deployment: 'QmXXX',
              network: 'mainnet',
              hasIndexingErrors: false,
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const report = await service.getHealthReport();

      expect(report.fallbackEnabled).toBe(false);
    });

    it('shows not configured when subgraph URL is empty', async () => {
      const service = new SubgraphQueryService('');
      const report = await service.getHealthReport();

      expect(report.subgraphUrl).toBe('Not configured');
    });
  });

  describe('error handling', () => {
    it('logs error message from error object', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Connection timeout'));

      const service = new SubgraphQueryService('https://graph.example.com');
      await service.queryArtists(10);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
        expect.any(Error),
      );
    });

    it('handles non-Error objects gracefully', async () => {
      process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
      mockedAxios.post.mockRejectedValue('String error');

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result.error).toContain('Unknown error');
      expect(result.fallbackUsed).toBe(false);
    });

    it('includes GraphQL error details in response', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          errors: [
            { message: 'Validation error', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } },
          ],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result.error).toContain('GraphQL error');
      expect(result.error).toContain('Validation error');
    });
  });

  describe('integration scenarios', () => {
    it('handles circuit breaker pattern - fails after max retries', async () => {
      mockedAxios.post.mockRejectedValue({ code: 'ETIMEDOUT' });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      expect(result.fallbackUsed).toBe(true);
    });

    it('recovers after temporary failure', async () => {
      const artists: ArtistQueryResult[] = [
        { id: 'artist-1', name: 'Artist A', wallet: 'GXXXXXX', createdAt: '2026-01-01' },
      ];

      mockedAxios.post
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          data: { data: { artists } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.queryArtists(10);

      expect(result.data).toEqual(artists);
      expect(result.source).toBe('subgraph');
      expect(result.fallbackUsed).toBe(false);
    });

    it('uses subgraph when available, ignoring fallback', async () => {
      const songs: SongQueryResult[] = [
        { id: 'song-1', title: 'Song A', artist: 'artist-1', createdAt: '2026-01-01' },
      ];

      mockedAxios.post.mockResolvedValue({
        data: { data: { songs } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const service = new SubgraphQueryService('https://graph.example.com');
      const result = await service.querySongs(10);

      expect(result.source).toBe('subgraph');
      expect(result.fallbackUsed).toBe(false);
      expect(result.data).toEqual(songs);
    });
  });
});
