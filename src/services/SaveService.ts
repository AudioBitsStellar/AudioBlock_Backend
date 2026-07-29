import { In, Repository } from 'typeorm';
import {
  UserSave,
  DEFAULT_SAVE_COLLECTION,
  SAVE_COLLECTION_MAX_LENGTH,
} from '../entities/UserSave';
import { Song } from '../entities/Song';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import { validateStringLength, validateUUID } from '../validators/ServiceValidator';

/** Default page size for library listings. */
const DEFAULT_LIBRARY_LIMIT = 20;

/** Hard cap on page size so a caller cannot request an unbounded page. */
const MAX_LIBRARY_LIMIT = 100;

/** A saved song as returned to clients. */
export interface SavedSongView {
  saveId: string;
  collection: string;
  savedAt: Date;
  song: {
    id: string;
    title: string;
    coverArtPath: string;
    duration: number;
    artistId: string;
  } | null;
}

export interface PaginatedLibrary {
  saves: SavedSongView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Outcome of a save: `alreadySaved` distinguishes a no-op from a fresh save. */
export interface SaveResult {
  save: UserSave;
  alreadySaved: boolean;
}

/**
 * Service layer for user song saves/bookmarks (Issue #91).
 */
export class SaveService {
  private saveRepo: Repository<UserSave>;
  private songRepo: Repository<Song>;

  constructor() {
    this.saveRepo = AppDataSource.getRepository(UserSave);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Saves a song to a user's library. Idempotent: saving a song already present
   * in the same collection returns the existing save rather than duplicating it.
   *
   * @param userId - Owner of the library
   * @param songId - Song to save
   * @param collection - Optional collection name (defaults to "Favorites")
   * @returns The save and whether it already existed
   * @throws {AppError} When the song does not exist or the collection is invalid
   */
  async saveSong(userId: string, songId: string, collection?: string): Promise<SaveResult> {
    validateUUID(userId, 'userId');
    validateUUID(songId, 'songId');

    const collectionName = this.normalizeCollection(collection);

    const song = await this.songRepo.findOne({ where: { id: songId } });

    if (!song) {
      throw AppError.notFound(ERROR_MESSAGES.SONG_NOT_FOUND);
    }

    const existing = await this.saveRepo.findOne({
      where: { userId, songId, collection: collectionName },
    });

    if (existing) {
      return { save: existing, alreadySaved: true };
    }

    const save = this.saveRepo.create({ userId, songId, collection: collectionName });

    try {
      const saved = await this.saveRepo.save(save);
      return { save: saved, alreadySaved: false };
    } catch (error) {
      // Two concurrent saves race past the existence check above; the unique
      // constraint is the real guard, so treat a violation as "already saved"
      // and return the row the other request wrote.
      const raced = await this.saveRepo.findOne({
        where: { userId, songId, collection: collectionName },
      });

      if (raced) {
        return { save: raced, alreadySaved: true };
      }

      throw error;
    }
  }

  /**
   * Removes a song from a user's library.
   *
   * @param userId - Owner of the library
   * @param songId - Song to unsave
   * @param collection - When given, only that collection's save is removed;
   *   otherwise the song is removed from every collection
   * @returns Number of saves removed
   * @throws {AppError} When the song was not saved
   */
  async unsaveSong(userId: string, songId: string, collection?: string): Promise<number> {
    validateUUID(userId, 'userId');
    validateUUID(songId, 'songId');

    const where =
      collection === undefined || collection === null || collection === ''
        ? { userId, songId }
        : { userId, songId, collection: this.normalizeCollection(collection) };

    const saves = await this.saveRepo.find({ where });

    if (saves.length === 0) {
      throw AppError.notFound('Song is not saved in your library');
    }

    await this.saveRepo.remove(saves);

    return saves.length;
  }

  /**
   * Lists a user's saved songs, newest first.
   *
   * @param userId - Owner of the library
   * @param page - 1-based page number
   * @param limit - Page size, capped at {@link MAX_LIBRARY_LIMIT}
   * @param collection - Optional filter to a single collection
   * @returns Paginated saved songs
   */
  async getUserLibrary(
    userId: string,
    page = 1,
    limit = DEFAULT_LIBRARY_LIMIT,
    collection?: string,
  ): Promise<PaginatedLibrary> {
    validateUUID(userId, 'userId');

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || DEFAULT_LIBRARY_LIMIT),
      MAX_LIBRARY_LIMIT,
    );

    const where =
      collection === undefined || collection === null || collection === ''
        ? { userId }
        : { userId, collection: this.normalizeCollection(collection) };

    const [saves, total] = await this.saveRepo.findAndCount({
      where,
      relations: ['song'],
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      saves: saves.map((save) => this.toView(save)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Lists the distinct collection names in a user's library with their sizes,
   * so a client can render the library's groupings without paging all saves.
   *
   * @param userId - Owner of the library
   * @returns Collection names and counts, largest first
   */
  async getUserCollections(userId: string): Promise<{ collection: string; count: number }[]> {
    validateUUID(userId, 'userId');

    const rows = await this.saveRepo
      .createQueryBuilder('save')
      .select('save.collection', 'collection')
      .addSelect('COUNT(save.id)', 'count')
      .where('save.userId = :userId', { userId })
      .groupBy('save.collection')
      .orderBy('COUNT(save.id)', 'DESC')
      .getRawMany<{ collection: string; count: string }>();

    return rows.map((row) => ({ collection: row.collection, count: Number(row.count) }));
  }

  /**
   * True when the user has saved the song in any collection. Used to populate
   * the `isSaved` flag on song responses.
   *
   * @param userId - Viewer
   * @param songId - Song being checked
   */
  async hasUserSaved(userId: string, songId: string): Promise<boolean> {
    validateUUID(userId, 'userId');
    validateUUID(songId, 'songId');

    const count = await this.saveRepo.count({ where: { userId, songId } });

    return count > 0;
  }

  /**
   * Resolves saved state for many songs in one query, so a song list can be
   * annotated without an N+1 lookup per row.
   *
   * @param userId - Viewer
   * @param songIds - Songs being checked
   * @returns Set of the song ids the user has saved
   */
  async getSavedSongIds(userId: string, songIds: string[]): Promise<Set<string>> {
    if (songIds.length === 0) {
      return new Set();
    }

    validateUUID(userId, 'userId');

    const saves = await this.saveRepo.find({
      where: { userId, songId: In(songIds) },
      select: ['songId'],
    });

    return new Set(saves.map((save) => save.songId));
  }

  /** Trims a collection name and applies the default when none is supplied. */
  private normalizeCollection(collection?: string): string {
    if (collection === undefined || collection === null || collection === '') {
      return DEFAULT_SAVE_COLLECTION;
    }

    const trimmed = String(collection).trim();

    if (trimmed === '') {
      return DEFAULT_SAVE_COLLECTION;
    }

    validateStringLength(trimmed, 'collection', 1, SAVE_COLLECTION_MAX_LENGTH);

    return trimmed;
  }

  /** Maps an entity to its wire representation. */
  private toView(save: UserSave): SavedSongView {
    return {
      saveId: save.id,
      collection: save.collection,
      savedAt: save.createdAt,
      song: save.song
        ? {
            id: save.song.id,
            title: save.song.title,
            coverArtPath: save.song.coverArtPath,
            duration: save.song.duration,
            artistId: save.song.artistId,
          }
        : null,
    };
  }
}
