import { In, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import { AppError } from '../errors/AppError';
import logger from '../config/logger';
import { BatchOperation, BatchResponseItem } from '../types/BatchTypes';

/** Maximum number of songs accepted in one bulk catalog operation. */
export const BULK_CATALOG_MAX_BATCH = 50;

/** Per-song outcome for a native batch catalog operation. */
export interface BulkCatalogItemResult {
  songId: string;
  status: number;
  body: unknown;
}

export interface BulkCatalogResponse {
  operation: BatchOperation;
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkCatalogItemResult[];
}

/**
 * Native batch operations on an artist's song catalog.
 *
 * Each song is processed independently: one failure (missing song, write error)
 * does not abort the rest, and every attempt produces a result row. Results use
 * the same `{ status, body }` convention as the generic batch dispatcher so
 * partial-failure reporting is uniform across batch operation types.
 */
export class BatchCatalogService {
  private songRepo: Repository<Song>;

  constructor() {
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Update the genre of multiple songs belonging to the caller's catalog.
   *
   * @param songIds - Song IDs to update (1..{@link BULK_CATALOG_MAX_BATCH}).
   * @param genre - New genre value.
   * @returns Per-song results plus success/failure counts.
   * @throws {AppError} 400 when the batch is empty, oversized, or the genre is
   *   not a non-empty string.
   */
  async bulkGenreUpdate(songIds: unknown, genre: unknown): Promise<BulkCatalogResponse> {
    const ids = this.parseSongIds(songIds);
    const newGenre = this.parseGenre(genre);

    const songs = await this.songRepo.find({ where: { id: In(ids) } });
    const bySongId = new Map(songs.map((s) => [s.id, s]));

    const results: BulkCatalogItemResult[] = [];

    for (const songId of ids) {
      const song = bySongId.get(songId);
      if (!song) {
        results.push({
          songId,
          status: 404,
          body: { error: { code: 'SONG_NOT_FOUND', message: `Song ${songId} not found` } },
        });
        continue;
      }

      try {
        song.genre = newGenre;
        await this.songRepo.save(song);
        results.push({
          songId,
          status: 200,
          body: { success: true, genre: newGenre, songId },
        });
      } catch (err) {
        results.push({
          songId,
          status: 500,
          body: {
            error: {
              code: 'GENRE_UPDATE_FAILED',
              message: err instanceof Error ? err.message : 'Genre update failed',
            },
          },
        });
      }
    }

    const succeeded = results.filter((r) => r.status === 200).length;

    logger.info(
      { operation: 'bulkGenreUpdate', requested: ids.length, succeeded, failed: ids.length - succeeded },
      'Bulk catalog genre update completed',
    );

    return {
      operation: 'bulkGenreUpdate',
      requested: ids.length,
      succeeded,
      failed: ids.length - succeeded,
      results,
    };
  }

  private parseSongIds(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw AppError.validation('songIds must be a non-empty array', { field: 'songIds' }, 'INVALID_SONG_IDS');
    }
    if (raw.some((id) => typeof id !== 'string' || id.trim() === '')) {
      throw AppError.validation('songIds must contain only non-empty strings', { field: 'songIds' }, 'INVALID_SONG_IDS');
    }
    const ids = [...new Set(raw.map((id) => (id as string).trim()))];
    if (ids.length > BULK_CATALOG_MAX_BATCH) {
      throw AppError.validation(
        `Batch size exceeds the maximum of ${BULK_CATALOG_MAX_BATCH} songs per request`,
        { field: 'songIds', value: ids.length },
        'BATCH_TOO_LARGE',
      );
    }
    return ids;
  }

  private parseGenre(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (value === '') {
      throw AppError.validation('genre must be a non-empty string', { field: 'genre', value: raw }, 'INVALID_GENRE');
    }
    return value;
  }

  /** Convert service results to the controller's `BatchResponseItem[]` shape. */
  toResponseItems(results: BulkCatalogItemResult[]): BatchResponseItem[] {
    return results.map(({ songId, status, body }) => ({
      status,
      body: { ...body, songId },
    }));
  }
}
