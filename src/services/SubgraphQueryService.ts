/**
 * SubgraphQueryService: Queries The Graph subgraph with automatic fallback to direct RPC queries.
 *
 * This service fetches indexed data from The Graph subgraph. Entity-level RPC
 * fallback is not available until RPC events can be mapped to these query shapes.
 *
 * Query modes:
 * - Primary: The Graph GraphQL subgraph API
 * - Fallback: Direct Soroban RPC getEvents API
 */

import { SorobanEventReader, NormalizedContractEvent } from './Soroban/SorobanEventReader';
import logger from '../config/logger';
import axios, { AxiosError } from 'axios';

interface SubgraphMeta {
  block?: {
    number?: number;
    hash?: string | null;
  };
  hasIndexingErrors?: boolean;
}

interface SubgraphQueryConfig {
  apiKey?: string;
  endpointTemplate?: string;
  retryAttempts?: number;
  requestTimeoutMs?: number;
  retryBaseDelayMs?: number;
  pageSize?: number;
  consistencyRetries?: number;
}

interface Snapshot {
  number: number;
  hash: string;
}

function configuredNumber(
  value: number | undefined,
  environmentValue: string | undefined,
  fallback: number,
): number {
  const parsed = value ?? (environmentValue === undefined ? fallback : Number(environmentValue));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface SubgraphQueryResult<T> {
  data: T | null;
  source: 'subgraph' | 'rpc-fallback';
  error: string | null;
  fallbackUsed: boolean;
}

export interface ArtistQueryResult {
  id: string;
  name: string;
  wallet: string;
  totalTracks?: string;
  totalSalesCount?: string;
  totalVolume?: string;
  createdAt: string;
}

export interface SongQueryResult {
  id: string;
  title: string;
  artist: string;
  tokenId?: string;
  owner?: string;
  price?: string;
  isListed?: boolean;
  isMinted?: boolean;
  salesCount?: string;
  likeCount?: string;
  commentCount?: string;
  createdAt: string;
}

export class GraphQLClient {
  private endpoint: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(endpoint: string, apiKey: string, timeoutMs: number) {
    this.endpoint = GraphQLClient.resolveEndpoint(endpoint, apiKey);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async request<T>(
    query: string,
    variables?: Record<string, number | string>,
  ): Promise<{ data: T | null; error: string | null }> {
    if (!this.endpoint) {
      return { data: null, error: 'Subgraph URL not configured' };
    }

    const response = await axios.post(
      this.endpoint,
      { query, variables },
      {
        timeout: this.timeoutMs,
        headers: this.buildHeaders(),
      },
    );

    if (response.data.errors) {
      return { data: null, error: `GraphQL error: ${JSON.stringify(response.data.errors)}` };
    }

    if (response.data.data === undefined || response.data.data === null) {
      return { data: null, error: 'Subgraph response did not contain data' };
    }

    return { data: response.data.data as T, error: null };
  }

  getEndpointForHealthReport(): string {
    if (!this.endpoint) return 'Not configured';
    if (!this.apiKey) return this.endpoint;
    return GraphQLClient.replaceAll(
      GraphQLClient.replaceAll(this.endpoint, this.apiKey, '[redacted]'),
      encodeURIComponent(this.apiKey),
      '[redacted]',
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey && !this.endpoint.includes(this.apiKey)) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private static resolveEndpoint(endpoint: string, apiKey: string): string {
    if (!endpoint) return '';
    if (!apiKey) return endpoint;
    return GraphQLClient.replaceAll(endpoint, '{apiKey}', encodeURIComponent(apiKey));
  }

  private static replaceAll(value: string, search: string, replacement: string): string {
    return value.split(search).join(replacement);
  }
}

export class SubgraphQueryService {
  private graphClient: GraphQLClient;
  private rpcReader: SorobanEventReader;
  private fallbackEnabled: boolean;
  private retryAttempts: number;
  private requestTimeoutMs: number;
  private retryBaseDelayMs: number;
  private pageSize: number;
  private consistencyRetries: number;

  constructor(
    subgraphUrl?: string,
    rpcReader?: SorobanEventReader,
    config: SubgraphQueryConfig = {},
  ) {
    this.rpcReader = rpcReader || new SorobanEventReader();
    this.fallbackEnabled = process.env.SUBGRAPH_FALLBACK_ENABLED !== 'false';
    this.retryAttempts = Math.max(
      1,
      Math.floor(
        configuredNumber(config.retryAttempts, process.env.SUBGRAPH_QUERY_RETRY_ATTEMPTS, 3),
      ),
    );
    this.requestTimeoutMs = Math.max(
      1,
      Math.floor(
        configuredNumber(config.requestTimeoutMs, process.env.SUBGRAPH_QUERY_TIMEOUT_MS, 5000),
      ),
    );
    this.retryBaseDelayMs = Math.max(
      0,
      Math.floor(
        configuredNumber(
          config.retryBaseDelayMs,
          process.env.SUBGRAPH_QUERY_RETRY_BASE_DELAY_MS,
          100,
        ),
      ),
    );
    this.pageSize = Math.max(
      1,
      Math.min(
        1000,
        Math.floor(configuredNumber(config.pageSize, process.env.SUBGRAPH_QUERY_PAGE_SIZE, 1000)),
      ),
    );
    this.consistencyRetries = Math.max(
      0,
      Math.floor(
        configuredNumber(
          config.consistencyRetries,
          process.env.SUBGRAPH_QUERY_CONSISTENCY_RETRIES,
          1,
        ),
      ),
    );
    const apiKey = config.apiKey ?? process.env.GRAPH_SUBGRAPH_API_KEY ?? '';
    const endpoint =
      subgraphUrl ||
      config.endpointTemplate ||
      process.env.GRAPH_SUBGRAPH_URL ||
      process.env.GRAPH_SUBGRAPH_ENDPOINT_TEMPLATE ||
      '';
    this.graphClient = new GraphQLClient(endpoint, apiKey, this.requestTimeoutMs);
  }

  /**
   * Query artists from the subgraph, reporting when fallback is unavailable.
   */
  async queryArtists(limit: number = 100): Promise<SubgraphQueryResult<ArtistQueryResult[]>> {
    const result = await this.queryEntities<ArtistQueryResult>(
      'artists',
      'name wallet createdAt',
      limit,
    );
    if (result.error && this.fallbackEnabled) {
      logger.warn('Subgraph query failed for artists; RPC fallback is unavailable', result.error);
      return this.queryArtistsFromRpc(result.error);
    }
    return {
      data: result.data,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query songs from the subgraph, reporting when fallback is unavailable.
   */
  async querySongs(limit: number = 100): Promise<SubgraphQueryResult<SongQueryResult[]>> {
    const result = await this.queryEntities<SongQueryResult>(
      'songs',
      'title artist createdAt',
      limit,
    );
    if (result.error && this.fallbackEnabled) {
      logger.warn('Subgraph query failed for songs; RPC fallback is unavailable', result.error);
      return this.querySongsFromRpc(result.error);
    }
    return {
      data: result.data,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query full artist hierarchy (Artist -> Tracks -> Sales) from subgraph.
   */
  async queryArtistHierarchy(
    artistId: string,
  ): Promise<SubgraphQueryResult<ArtistHierarchyQueryResult | null>> {
    const query = `
      query GetArtistHierarchy($artistId: ID!) {
        artist(id: $artistId) {
          id
          name
          wallet
          totalTracks
          totalSalesCount
          totalVolume
          tracks {
            id
            title
            tokenId
            owner
            salesCount
            likeCount
            commentCount
            sales {
              id
              price
              seller
              buyer
              createdAt
            }
          }
          sales {
            id
            price
            seller
            buyer
            tokenId
            txHash
            createdAt
          }
        }
      }
    `;

    const result = await this.querySubgraph<{ artist: ArtistHierarchyQueryResult | null }>(query, {
      artistId,
    });

    return {
      data: result.data?.artist ?? null,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query sales from the subgraph.
   */
  async querySales(limit: number = 100): Promise<SubgraphQueryResult<SaleQueryResult[]>> {
    const query = `
      query GetSales($first: Int!) {
        sales(first: $first, orderBy: createdAt, orderDirection: desc) {
          id
          price
          tokenId
          seller
          buyer
          txHash
          ledger
          createdAt
          song {
            id
            title
          }
          artist {
            id
            name
          }
        }
      }
    `;

    const result = await this.querySubgraph<{ sales: SaleQueryResult[] }>(query, {
      first: limit,
    });

    return {
      data: result.data?.sales ?? null,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query transfers from the subgraph.
   */
  async queryTransfers(limit: number = 100): Promise<SubgraphQueryResult<TransferQueryResult[]>> {
    const query = `
      query GetTransfers($first: Int!) {
        transferEvents(first: $first, orderBy: createdAt, orderDirection: desc) {
          id
          tokenId
          from
          to
          txHash
          ledger
          createdAt
          song {
            id
            title
          }
        }
      }
    `;

    const result = await this.querySubgraph<{ transferEvents: TransferQueryResult[] }>(query, {
      first: limit,
    });

    return {
      data: result.data?.transferEvents ?? null,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query NFT mints from the subgraph.
   */
  async queryMints(limit: number = 100): Promise<SubgraphQueryResult<MintQueryResult[]>> {
    const query = `
      query GetMints($first: Int!) {
        mintEvents(first: $first, orderBy: createdAt, orderDirection: desc) {
          id
          tokenId
          minter
          tokenUri
          txHash
          ledger
          createdAt
          song {
            id
            title
          }
          artist {
            id
            name
          }
        }
      }
    `;

    const result = await this.querySubgraph<{ mintEvents: MintQueryResult[] }>(query, {
      first: limit,
    });

    return {
      data: result.data?.mintEvents ?? null,
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Query engagement (likes & comments) for a track.
   */
  async queryTrackEngagement(songId: string): Promise<
    SubgraphQueryResult<{
      likes: LikeQueryResult[];
      comments: CommentQueryResult[];
      likeCount: string;
      commentCount: string;
    } | null>
  > {
    const query = `
      query GetTrackEngagement($songId: ID!) {
        song(id: $songId) {
          likeCount
          commentCount
          likes(orderBy: createdAt, orderDirection: desc) {
            id
            user
            createdAt
            txHash
          }
          comments(orderBy: createdAt, orderDirection: desc) {
            id
            author
            content
            createdAt
            txHash
          }
        }
      }
    `;

    const result = await this.querySubgraph<{
      song: {
        likeCount: string;
        commentCount: string;
        likes: LikeQueryResult[];
        comments: CommentQueryResult[];
      } | null;
    }>(query, { songId });

    if (!result.data?.song) {
      return {
        data: null,
        source: 'subgraph',
        error: result.error,
        fallbackUsed: false,
      };
    }

    return {
      data: {
        likes: result.data.song.likes,
        comments: result.data.song.comments,
        likeCount: result.data.song.likeCount,
        commentCount: result.data.song.commentCount,
      },
      source: 'subgraph',
      error: result.error,
      fallbackUsed: false,
    };
  }

  /**
   * Fetch an ID-ordered entity snapshot using Graph's cursor pagination.
   */
  private async queryEntities<T extends { id: string }>(
    entity: 'artists' | 'songs',
    fields: string,
    limit: number,
  ): Promise<{ data: T[] | null; error: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      return { data: null, error: 'Subgraph result limit must be a non-negative integer' };
    }
    if (limit === 0) return { data: [], error: null };

    for (
      let snapshotAttempt = 0;
      snapshotAttempt <= this.consistencyRetries;
      snapshotAttempt += 1
    ) {
      const metaResult = await this.querySubgraph<{ _meta?: SubgraphMeta }>(
        'query SubgraphMeta { _meta { block { number hash } hasIndexingErrors } }',
      );
      if (metaResult.error) return { data: null, error: metaResult.error };

      const snapshot = this.readSnapshot(metaResult.data?._meta);
      if (typeof snapshot === 'string') return { data: null, error: snapshot };

      const entities: T[] = [];
      const seenIds = new Set<string>();
      let lastId = '';
      let consistencyError: string | null = null;

      while (entities.length < limit) {
        const first = Math.min(this.pageSize, limit - entities.length);
        const query = `
          query PaginatedEntities($first: Int!, $lastID: ID!, $blockNumber: Int!) {
            _meta(block: { number: $blockNumber }) {
              block { number hash }
              hasIndexingErrors
            }
            ${entity}(
              first: $first
              where: { id_gt: $lastID }
              orderBy: id
              orderDirection: asc
              block: { number: $blockNumber }
            ) {
              id ${fields}
            }
          }
        `;
        const pageResult = await this.querySubgraph<Record<string, T[]> & { _meta?: SubgraphMeta }>(
          query,
          { first, lastID: lastId, blockNumber: snapshot.number },
        );
        if (pageResult.error) return { data: null, error: pageResult.error };

        const pageSnapshot = this.readSnapshot(pageResult.data?._meta);
        if (typeof pageSnapshot === 'string') {
          consistencyError = pageSnapshot;
          break;
        }
        if (!this.sameSnapshot(snapshot, pageSnapshot)) {
          consistencyError = `Subgraph block changed while reading ${entity}`;
          break;
        }

        const page = pageResult.data?.[entity];
        if (!Array.isArray(page))
          return { data: null, error: `Subgraph response is missing ${entity}` };
        if (page.length === 0) break;
        if (page.length > first) {
          consistencyError = `Subgraph returned more ${entity} than requested`;
          break;
        }

        for (const item of page) {
          if (
            typeof item.id !== 'string' ||
            !item.id ||
            item.id <= lastId ||
            seenIds.has(item.id)
          ) {
            consistencyError = `Subgraph returned a duplicate or out-of-order ${entity} ID`;
            break;
          }
          seenIds.add(item.id);
          lastId = item.id;
          entities.push(item);
        }
        if (consistencyError || page.length < first) break;
      }

      if (!consistencyError) return { data: entities, error: null };
      if (snapshotAttempt === this.consistencyRetries) {
        return { data: null, error: consistencyError };
      }
      logger.warn(
        { entity, snapshotAttempt, error: consistencyError },
        'Retrying inconsistent subgraph snapshot',
      );
    }

    return { data: null, error: `Unable to read a consistent ${entity} snapshot` };
  }

  private readSnapshot(meta: SubgraphMeta | undefined): Snapshot | string {
    if (!meta?.block || !Number.isSafeInteger(meta.block.number)) {
      return 'Subgraph response is missing a valid _meta block number';
    }
    if (meta.hasIndexingErrors) return 'Subgraph reports indexing errors';
    if (typeof meta.block.hash !== 'string' || !meta.block.hash) {
      return 'Subgraph response is missing a block hash; snapshot consistency cannot be verified';
    }
    return { number: meta.block.number as number, hash: meta.block.hash };
  }

  private sameSnapshot(left: Snapshot, right: Snapshot): boolean {
    return left.number === right.number && left.hash === right.hash;
  }

  /** Generic GraphQL request with bounded exponential retry for transient failures. */
  private async querySubgraph<T>(
    query: string,
    variables?: Record<string, number | string>,
  ): Promise<{ data: T | null; error: string | null }> {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.graphClient.request<T>(query, variables);
      } catch (error) {
        const axError = error as AxiosError;
        const status = axError.response?.status;
        const retryable =
          status === undefined ||
          status === 429 ||
          status >= 500 ||
          ['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(
            axError.code ?? '',
          );
        const message = `Request failed: ${axError.message || 'Unknown error'}`;

        if (!retryable || attempt === this.retryAttempts) {
          return { data: null, error: message };
        }

        const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
        logger.warn(
          { attempt, maxAttempts: this.retryAttempts, delayMs, status, code: axError.code },
          'Transient subgraph request failure; retrying',
        );
        await this.delay(delayMs);
      }
    }

    return { data: null, error: 'Subgraph request failed after retries' };
  }

  /**
   * Fallback: Query artists from indexed events via RPC (simplified version).
   */
  private async queryArtistsFromRpc(
    subgraphError: string,
  ): Promise<SubgraphQueryResult<ArtistQueryResult[]>> {
    logger.warn('RPC fallback is unavailable for artist entity queries');
    return {
      data: null,
      source: 'rpc-fallback',
      error: `RPC fallback is not implemented for artists. Subgraph error: ${subgraphError}`,
      fallbackUsed: true,
    };
  }

  /**
   * Fallback: Query songs from indexed events via RPC.
   */
  private async querySongsFromRpc(
    subgraphError: string,
  ): Promise<SubgraphQueryResult<SongQueryResult[]>> {
    logger.warn('RPC fallback is unavailable for song entity queries');
    return {
      data: null,
      source: 'rpc-fallback',
      error: `RPC fallback is not implemented for songs. Subgraph error: ${subgraphError}`,
      fallbackUsed: true,
    };
  }

  /**
   * Check if subgraph is healthy.
   */
  async isSubgraphHealthy(): Promise<boolean> {
    try {
      const healthQuery = `
        query {
          _meta {
            deployment
            network
            block { number hash }
            hasIndexingErrors
          }
        }
      `;
      const result = await this.querySubgraph<{ _meta?: SubgraphMeta }>(healthQuery);
      return result.error === null && typeof this.readSnapshot(result.data?._meta) !== 'string';
    } catch {
      return false;
    }
  }

  /**
   * Get health status report.
   */
  async getHealthReport(): Promise<{
    subgraphHealthy: boolean;
    fallbackEnabled: boolean;
    subgraphUrl: string;
  }> {
    return {
      subgraphHealthy: await this.isSubgraphHealthy(),
      fallbackEnabled: this.fallbackEnabled,
      subgraphUrl: this.graphClient.getEndpointForHealthReport(),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
