import axios from 'axios';
import { CacheService } from '../CacheService';
import { GraphQLClient, SubgraphQueryService } from '../SubgraphQueryService';

jest.mock('axios');
jest.mock('../CacheService', () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GraphQLClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('substitutes API keys into endpoint templates without sending an auth header', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: { artists: [] } } });

    const client = new GraphQLClient(
      'https://gateway.thegraph.com/api/{apiKey}/subgraphs/id/audio',
      'studio key',
      5000,
    );

    await client.request('query { artists { id } }');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://gateway.thegraph.com/api/studio%20key/subgraphs/id/audio',
      { query: 'query { artists { id } }', variables: undefined },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(client.getEndpointForHealthReport()).toBe(
      'https://gateway.thegraph.com/api/[redacted]/subgraphs/id/audio',
    );
  });

  it('sends API keys as bearer tokens when the endpoint has no template placeholder', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: { songs: [] } } });

    const client = new GraphQLClient(
      'https://api.studio.thegraph.com/query/123/audio',
      'key',
      5000,
    );

    await client.request('query { songs { id } }');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.studio.thegraph.com/query/123/audio',
      { query: 'query { songs { id } }', variables: undefined },
      {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer key',
        },
      },
    );
  });
});

describe('SubgraphQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CacheService.get as jest.Mock).mockResolvedValue(null);
    (CacheService.set as jest.Mock).mockResolvedValue(undefined);
    delete process.env.GRAPH_SUBGRAPH_API_KEY;
    delete process.env.GRAPH_SUBGRAPH_ENDPOINT_TEMPLATE;
    delete process.env.GRAPH_SUBGRAPH_URL;
    process.env.SUBGRAPH_FALLBACK_ENABLED = 'false';
  });

  it('queries songs through the configured GraphQL endpoint', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          data: {
            _meta: { block: { number: 10, hash: '0xabc' }, hasIndexingErrors: false },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            _meta: { block: { number: 10, hash: '0xabc' }, hasIndexingErrors: false },
            songs: [{ id: 'song-1', title: 'Track', artist: 'artist-1', createdAt: '100' }],
          },
        },
      });

    const service = new SubgraphQueryService('https://graph.example/subgraphs/audio', undefined, {
      pageSize: 1,
    });

    await expect(service.querySongs(1)).resolves.toEqual({
      data: [{ id: 'song-1', title: 'Track', artist: 'artist-1', createdAt: '100' }],
      source: 'subgraph',
      error: null,
      fallbackUsed: false,
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('serves repeated successful queries from cache', async () => {
    const cachedResult = {
      data: [{ id: 'song-1', title: 'Track', artist: 'artist-1', createdAt: '100' }],
      source: 'subgraph',
      error: null,
      fallbackUsed: false,
    } as const;
    (CacheService.get as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(cachedResult);
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          data: {
            _meta: { block: { number: 10, hash: '0xabc' }, hasIndexingErrors: false },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            _meta: { block: { number: 10, hash: '0xabc' }, hasIndexingErrors: false },
            songs: cachedResult.data,
          },
        },
      });

    const service = new SubgraphQueryService('https://graph.example/subgraphs/audio', undefined, {
      pageSize: 1,
      cacheTtlMs: 30000,
    });

    await expect(service.querySongs(1)).resolves.toEqual(cachedResult);
    await expect(service.querySongs(1)).resolves.toEqual(cachedResult);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(CacheService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^subgraph:v1:[a-f0-9]{16}:songs:1$/),
      cachedResult,
      30000,
    );
  });

  it('does not cache failed subgraph responses', async () => {
    mockedAxios.post.mockResolvedValue({ data: { errors: [{ message: 'unavailable' }] } });

    const service = new SubgraphQueryService('https://graph.example/subgraphs/audio', undefined, {
      retryAttempts: 1,
      cacheTtlMs: 30000,
    });

    await expect(service.querySongs(1)).resolves.toMatchObject({
      data: null,
      error: expect.stringContaining('GraphQL error'),
    });
    expect(CacheService.set).not.toHaveBeenCalled();
  });

  it('uses endpoint templates and redacts API keys in health reports', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: {
          _meta: { block: { number: 10, hash: '0xabc' }, hasIndexingErrors: false },
        },
      },
    });

    const service = new SubgraphQueryService(undefined, undefined, {
      apiKey: 'secret',
      endpointTemplate: 'https://gateway.thegraph.com/api/{apiKey}/subgraphs/id/audio',
    });

    await expect(service.getHealthReport()).resolves.toEqual({
      subgraphHealthy: true,
      fallbackEnabled: false,
      subgraphUrl: 'https://gateway.thegraph.com/api/[redacted]/subgraphs/id/audio',
    });
  });
});
