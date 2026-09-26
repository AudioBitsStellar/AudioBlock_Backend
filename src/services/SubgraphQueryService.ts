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
  createdAt: string;
}

export interface SongQueryResult {
  id: string;
  title: string;
  artist: string;
  createdAt: string;
}

export class SubgraphQueryService {
  private subgraphUrl: string;
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
    this.subgraphUrl = subgraphUrl || process.env.GRAPH_SUBGRAPH_URL || '';
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
        configuredNumber(config.retryBaseDelayMs, process.env.SUBGRAPH_QUERY_RETRY_BASE_DELAY_MS, 100),
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
          if (typeof item.id !== 'string' || !item.id || item.id <= lastId || seenIds.has(item.id)) {
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
    if (!this.subgraphUrl) {
      return { data: null, error: 'Subgraph URL not configured' };
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios.post(
          this.subgraphUrl,
          { query, variables },
          {
            timeout: this.requestTimeoutMs,
            headers: { 'Content-Type': 'application/json' },
          },
        );

        if (response.data.errors) {
          return { data: null, error: `GraphQL error: ${JSON.stringify(response.data.errors)}` };
        }

        if (response.data.data === undefined || response.data.data === null) {
          return { data: null, error: 'Subgraph response did not contain data' };
        }
        return { data: response.data.data as T, error: null };
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
      subgraphUrl: this.subgraphUrl || 'Not configured',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
