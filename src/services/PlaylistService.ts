import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Playlist } from '../entities/Playlist';
import { PlaylistSong } from '../entities/PlaylistSong';
import { Song } from '../entities/Song';
import { AppError } from '../errors/AppError';

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
  coverImageUrl?: string;
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
  coverImageUrl?: string;
}

/**
 * Manages playlists: CRUD operations, song association, and ordering
 * (Issue #77). Every mutation is scoped to the playlist owner — a user can
 * only modify their own playlists.
 */
export class PlaylistService {
  private playlistRepo: Repository<Playlist>;
  private playlistSongRepo: Repository<PlaylistSong>;
  private songRepo: Repository<Song>;

  constructor() {
    this.playlistRepo = AppDataSource.getRepository(Playlist);
    this.playlistSongRepo = AppDataSource.getRepository(PlaylistSong);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Create a new playlist owned by the given user.
   */
  async create(userId: string, input: CreatePlaylistInput): Promise<Playlist> {
    if (!input.name || !input.name.trim()) {
      throw AppError.validation('Playlist name is required', undefined, 'PLAYLIST_NAME_REQUIRED');
    }

    const playlist = this.playlistRepo.create({
      userId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      isPublic: input.isPublic ?? true,
      coverImageUrl: input.coverImageUrl || undefined,
      songs: [],
    });
    return this.playlistRepo.save(playlist);
  }

  /**
   * List a user's playlists, newest first, with song counts.
   */
  async listForUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Playlist[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const [items, total] = await this.playlistRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: { songs: true },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      data: items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 0,
      },
    };
  }

  /**
   * Get a single playlist with its songs ordered by position.
   *
   * Public playlists are readable by anyone; private playlists are only
   * readable by their owner.
   */
  async getById(playlistId: string, viewerId?: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOne({
      where: { id: playlistId },
      relations: { songs: { song: true } },
      order: { songs: { position: 'ASC' } },
    });

    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }

    if (!playlist.isPublic && playlist.userId !== viewerId) {
      throw AppError.authorization(
        'You do not have access to this playlist',
        undefined,
        'PLAYLIST_PRIVATE',
      );
    }

    return playlist;
  }

  /**
   * Update playlist metadata. Only the owner may update.
   */
  async update(playlistId: string, userId: string, input: UpdatePlaylistInput): Promise<Playlist> {
    const playlist = await this.ownedPlaylist(playlistId, userId);

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw AppError.validation(
          'Playlist name cannot be empty',
          undefined,
          'PLAYLIST_NAME_REQUIRED',
        );
      }
      playlist.name = input.name.trim();
    }
    if (input.description !== undefined) {
      playlist.description = input.description.trim() || '';
    }
    if (input.isPublic !== undefined) {
      playlist.isPublic = input.isPublic;
    }
    if (input.coverImageUrl !== undefined) {
      playlist.coverImageUrl = input.coverImageUrl || '';
    }

    return this.playlistRepo.save(playlist);
  }

  /**
   * Delete a playlist. Only the owner may delete.
   */
  async remove(playlistId: string, userId: string): Promise<void> {
    await this.ownedPlaylist(playlistId, userId);
    await this.playlistRepo.delete({ id: playlistId });
  }

  /**
   * Add a song to a playlist, appending it after the current last position.
   * Adding an already-present song is a no-op (idempotent).
   */
  async addSong(playlistId: string, userId: string, songId: string): Promise<PlaylistSong> {
    await this.ownedPlaylist(playlistId, userId);

    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) {
      throw AppError.notFound('Song not found', undefined, 'SONG_NOT_FOUND');
    }

    const existing = await this.playlistSongRepo.findOne({
      where: { playlistId, songId },
    });
    if (existing) {
      return existing;
    }

    const maxPosition = await this.playlistSongRepo.maximum('position', { playlistId });
    const entry = this.playlistSongRepo.create({
      playlistId,
      songId,
      position: (maxPosition ?? -1) + 1,
    });
    return this.playlistSongRepo.save(entry);
  }

  /**
   * Remove a song from a playlist.
   */
  async removeSong(playlistId: string, userId: string, songId: string): Promise<void> {
    await this.ownedPlaylist(playlistId, userId);

    const result = await this.playlistSongRepo.delete({ playlistId, songId });
    if (!result.affected) {
      throw AppError.notFound('Song is not in this playlist', undefined, 'PLAYLIST_SONG_NOT_FOUND');
    }
  }

  /**
   * Reorder the songs in a playlist to match the given song id order.
   * Every song id must currently belong to the playlist.
   */
  async reorder(playlistId: string, userId: string, songIds: string[]): Promise<Playlist> {
    await this.ownedPlaylist(playlistId, userId);

    if (!Array.isArray(songIds) || songIds.length === 0) {
      throw AppError.validation(
        'songIds must be a non-empty array of song ids',
        undefined,
        'PLAYLIST_REORDER_INVALID',
      );
    }

    const entries = await this.playlistSongRepo.find({ where: { playlistId } });
    const entryBySongId = new Map(entries.map((entry) => [entry.songId, entry]));

    const missing = songIds.filter((songId) => !entryBySongId.has(songId));
    if (missing.length > 0) {
      throw AppError.validation(
        `Songs not in playlist: ${missing.join(', ')}`,
        undefined,
        'PLAYLIST_SONG_NOT_FOUND',
      );
    }

    await this.playlistSongRepo.save(
      songIds.map((songId, index) => {
        const entry = entryBySongId.get(songId)!;
        entry.position = index;
        return entry;
      }),
    );

    return this.getById(playlistId, userId);
  }

  /**
   * Load a playlist and verify the user owns it.
   */
  private async ownedPlaylist(playlistId: string, userId: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOneBy({ id: playlistId });
    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }
    if (playlist.userId !== userId) {
      throw AppError.authorization(
        'You can only modify your own playlists',
        undefined,
        'NOT_PLAYLIST_OWNER',
      );
    }
    return playlist;
  }
}
