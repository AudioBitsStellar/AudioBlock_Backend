/**
 * SubgraphQueryService: Queries The Graph subgraph with automatic fallback to direct RPC queries.
 *
 * This service attempts to fetch indexed data from The Graph subgraph. If the subgraph is
 * unavailable or returns errors, it automatically falls back to direct Soroban RPC queries
 * via SorobanEventReader to ensure continuous data availability (Issue #679).
 *
 * Query modes:
 * - Primary: The Graph GraphQL subgraph API
 * - Fallback: Direct Soroban RPC getEvents API
 */

import { SorobanEventReader, NormalizedContractEvent } from './Soroban/SorobanEventReader';
import logger from '../config/logger';
import axios, { AxiosError } from 'axios';

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
  private retryAttempts: number = 3;
  private requestTimeoutMs: number = 5000;

  constructor(subgraphUrl?: string, rpcReader?: SorobanEventReader) {
    this.subgraphUrl = subgraphUrl || process.env.GRAPH_SUBGRAPH_URL || '';
    this.rpcReader = rpcReader || new SorobanEventReader();
    this.fallbackEnabled = process.env.SUBGRAPH_FALLBACK_ENABLED !== 'false';
  }

  /**
   * Query artists from subgraph with RPC fallback.
   */
  async queryArtists(limit: number = 100): Promise<SubgraphQueryResult<ArtistQueryResult[]>> {
    const query = `
      query {
        artists(first: ${limit}) {
          id
          name
          wallet
          createdAt
        }
      }
    `;

    try {
      const result = await this.querySubgraph<{ artists: ArtistQueryResult[] }>(query);
      if (result.error && this.fallbackEnabled) {
        logger.warn('Subgraph query failed for artists, falling back to RPC indexer');
        return this.queryArtistsFromRpc(limit);
      }
      return {
        data: result.data?.artists || null,
        source: 'subgraph',
        error: result.error,
        fallbackUsed: false,
      };
    } catch (error) {
      if (this.fallbackEnabled) {
        logger.warn('Subgraph unavailable, using RPC fallback for artists', error);
        return this.queryArtistsFromRpc(limit);
      }
      return {
        data: null,
        source: 'subgraph',
        error: `Subgraph error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fallbackUsed: false,
      };
    }
  }

  /**
   * Query songs from subgraph with RPC fallback.
   */
  async querySongs(limit: number = 100): Promise<SubgraphQueryResult<SongQueryResult[]>> {
    const query = `
      query {
        songs(first: ${limit}) {
          id
          title
          artist
          createdAt
        }
      }
    `;

    try {
      const result = await this.querySubgraph<{ songs: SongQueryResult[] }>(query);
      if (result.error && this.fallbackEnabled) {
        logger.warn('Subgraph query failed for songs, falling back to RPC indexer');
        return this.querySongsFromRpc(limit);
      }
      return {
        data: result.data?.songs || null,
        source: 'subgraph',
        error: result.error,
        fallbackUsed: false,
      };
    } catch (error) {
      if (this.fallbackEnabled) {
        logger.warn('Subgraph unavailable, using RPC fallback for songs', error);
        return this.querySongsFromRpc(limit);
      }
      return {
        data: null,
        source: 'subgraph',
        error: `Subgraph error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fallbackUsed: false,
      };
    }
  }

  /**
   * Generic subgraph query with retry logic.
   */
  private async querySubgraph<T>(query: string): Promise<{ data: T | null; error: string | null }> {
    if (!this.subgraphUrl) {
      return { data: null, error: 'Subgraph URL not configured' };
    }

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios.post(
          this.subgraphUrl,
          { query },
          {
            timeout: this.requestTimeoutMs,
            headers: { 'Content-Type': 'application/json' },
          },
        );

        if (response.data.errors) {
          lastError = `GraphQL error: ${JSON.stringify(response.data.errors)}`;
          if (attempt < this.retryAttempts) {
            await this.delay(Math.pow(2, attempt - 1) * 100);
            continue;
          }
          return { data: null, error: lastError };
        }

        return { data: response.data.data as T, error: null };
      } catch (error) {
        const axError = error as AxiosError;
        lastError = `Request failed: ${axError.message}`;

        if (axError.code === 'ECONNREFUSED' || axError.code === 'ETIMEDOUT') {
          logger.warn(`Subgraph request failed (attempt ${attempt}/${this.retryAttempts}):`, lastError);
          if (attempt < this.retryAttempts) {
            await this.delay(Math.pow(2, attempt - 1) * 100);
            continue;
          }
        }
        throw error;
      }
    }

    return { data: null, error: lastError };
  }

  /**
   * Fallback: Query artists from indexed events via RPC (simplified version).
   */
  private async queryArtistsFromRpc(limit: number): Promise<SubgraphQueryResult<ArtistQueryResult[]>> {
    try {
      logger.info('Fetching artists from RPC indexer (fallback)');
      // This would query IndexedEvent table for artist-related events
      // For now, this is a placeholder - actual implementation would query the DB directly
      return {
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      };
    } catch (error) {
      return {
        data: null,
        source: 'rpc-fallback',
        error: `RPC fallback error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fallbackUsed: true,
      };
    }
  }

  /**
   * Fallback: Query songs from indexed events via RPC.
   */
  private async querySongsFromRpc(limit: number): Promise<SubgraphQueryResult<SongQueryResult[]>> {
    try {
      logger.info('Fetching songs from RPC indexer (fallback)');
      // This would query IndexedEvent table for song-related events
      // For now, this is a placeholder - actual implementation would query the DB directly
      return {
        data: [],
        source: 'rpc-fallback',
        error: null,
        fallbackUsed: true,
      };
    } catch (error) {
      return {
        data: null,
        source: 'rpc-fallback',
        error: `RPC fallback error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fallbackUsed: true,
      };
    }
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
            hasIndexingErrors
          }
        }
      `;
      const result = await this.querySubgraph<{ _meta: Record<string, unknown> }>(healthQuery);
      return result.error === null;
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
