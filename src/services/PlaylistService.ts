import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Playlist, PlaylistRule } from '../entities/Playlist';
import { PlaylistSong } from '../entities/PlaylistSong';
import { PlaylistCollaborator, PlaylistCollaboratorRole } from '../entities/PlaylistCollaborator';
import { Song } from '../entities/Song';
import { AppError } from '../errors/AppError';

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
  coverImageUrl?: string;
  isRuleBased?: boolean;
  rule?: PlaylistRule | null;
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
  coverImageUrl?: string;
  isRuleBased?: boolean;
  rule?: PlaylistRule | null;
}

export interface AddCollaboratorInput {
  userId: string;
  role: PlaylistCollaboratorRole;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Manages playlists: CRUD, song association, ordering, sharing (Issue #406)
 * and smart/rule-based playlists (Issue #407).
 *
 * Read access: public playlists are readable by anyone; private playlists are
 * readable by their owner or an invited collaborator (viewer or editor).
 *
 * Edit access: the owner and any `editor` collaborator may mutate the playlist
 * and its songs. Only the owner may delete the playlist or manage its
 * collaborators.
 *
 * Rule-based playlists store filter criteria in `rule` and resolve their
 * membership dynamically at read time instead of persisting playlist_songs
 * rows.
 */
export class PlaylistService {
  private playlistRepo: Repository<Playlist>;
  private playlistSongRepo: Repository<PlaylistSong>;
  private collaboratorRepo: Repository<PlaylistCollaborator>;
  private songRepo: Repository<Song>;

  constructor() {
    this.playlistRepo = AppDataSource.getRepository(Playlist);
    this.playlistSongRepo = AppDataSource.getRepository(PlaylistSong);
    this.collaboratorRepo = AppDataSource.getRepository(PlaylistCollaborator);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Create a new playlist owned by the given user.
   */
  async create(userId: string, input: CreatePlaylistInput): Promise<Playlist> {
    if (!input.name || !input.name.trim()) {
      throw AppError.validation('Playlist name is required', undefined, 'PLAYLIST_NAME_REQUIRED');
    }

    const isRuleBased = input.isRuleBased === true;
    this.assertValidRule(isRuleBased, input.rule);

    const playlist = this.playlistRepo.create({
      userId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      isPublic: input.isPublic ?? true,
      coverImageUrl: input.coverImageUrl || undefined,
      isRuleBased,
      rule: isRuleBased ? (input.rule ?? null) : null,
      songs: [],
    });
    return this.playlistRepo.save(playlist);
  }

  /**
   * List a user's playlists (owned or shared), newest first, with song counts.
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
   * Public playlists are readable by anyone; private playlists are readable by
   * their owner or an invited collaborator. Rule-based playlists have their
   * membership resolved at read time and returned in the same `songs` shape.
   */
  async getById(playlistId: string, viewerId?: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOne({
      where: { id: playlistId },
      relations: {
        songs: { song: true },
        collaborators: true,
      },
      order: { songs: { position: 'ASC' } },
    });

    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }

    const canRead = await this.canRead(playlist, viewerId);
    if (!canRead) {
      throw AppError.authorization(
        'You do not have access to this playlist',
        undefined,
        'PLAYLIST_PRIVATE',
      );
    }

    if (playlist.isRuleBased) {
      playlist.songs = await this.resolveRuleSongs(playlist);
    }

    return playlist;
  }

  /**
   * Update playlist metadata. Owner or an editor collaborator may update.
   */
  async update(playlistId: string, userId: string, input: UpdatePlaylistInput): Promise<Playlist> {
    const playlist = await this.getEditablePlaylist(playlistId, userId);

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
    if (input.isRuleBased !== undefined) {
      this.assertValidRule(input.isRuleBased, input.rule);
      playlist.isRuleBased = input.isRuleBased;
      if (!input.isRuleBased) {
        playlist.rule = null;
      } else if (input.rule !== undefined) {
        playlist.rule = input.rule;
      }
    } else if (input.rule !== undefined) {
      this.assertValidRule(playlist.isRuleBased, input.rule);
      playlist.rule = input.rule;
    }

    return this.playlistRepo.save(playlist);
  }

  /**
   * Delete a playlist. Only the owner may delete.
   */
  async remove(playlistId: string, userId: string): Promise<void> {
    await this.getOwnedPlaylist(playlistId, userId);
    await this.playlistRepo.delete({ id: playlistId });
  }

  /**
   * Add a song to a playlist, appending it after the current last position.
   * Adding an already-present song is a no-op (idempotent).
   * Owner or an editor collaborator may add songs.
   */
  async addSong(playlistId: string, userId: string, songId: string): Promise<PlaylistSong> {
    const playlist = await this.getEditablePlaylist(playlistId, userId);

    if (playlist.isRuleBased) {
      throw AppError.validation(
        'Cannot manually add songs to a rule-based playlist',
        undefined,
        'PLAYLIST_RULE_BASED',
      );
    }

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
   * Remove a song from a playlist. Owner or an editor collaborator may remove.
   */
  async removeSong(playlistId: string, userId: string, songId: string): Promise<void> {
    const playlist = await this.getEditablePlaylist(playlistId, userId);
    if (playlist.isRuleBased) {
      throw AppError.validation(
        'Cannot manually remove songs from a rule-based playlist',
        undefined,
        'PLAYLIST_RULE_BASED',
      );
    }

    const result = await this.playlistSongRepo.delete({ playlistId, songId });
    if (!result.affected) {
      throw AppError.notFound('Song is not in this playlist', undefined, 'PLAYLIST_SONG_NOT_FOUND');
    }
  }

  /**
   * Reorder the songs in a playlist to match the given song id order.
   * Owner or an editor collaborator may reorder.
   */
  async reorder(playlistId: string, userId: string, songIds: string[]): Promise<Playlist> {
    const playlist = await this.getEditablePlaylist(playlistId, userId);
    if (playlist.isRuleBased) {
      throw AppError.validation(
        'Cannot manually reorder a rule-based playlist',
        undefined,
        'PLAYLIST_RULE_BASED',
      );
    }

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
   * List the collaborators of a playlist. Reader (owner/collaborator) only.
   */
  async listCollaborators(playlistId: string, viewerId?: string): Promise<PlaylistCollaborator[]> {
    const playlist = await this.getReadablePlaylist(playlistId, viewerId);
    void playlist;
    return this.collaboratorRepo.find({
      where: { playlistId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Invite a user to a playlist. Only the owner may invite. The owner is not
   * stored as a collaborator row.
   */
  async addCollaborator(
    playlistId: string,
    ownerId: string,
    input: AddCollaboratorInput,
  ): Promise<PlaylistCollaborator> {
    await this.getOwnedPlaylist(playlistId, ownerId);

    if (!input.userId) {
      throw AppError.validation('userId is required', undefined, 'COLLABORATOR_USER_REQUIRED');
    }
    if (input.userId === ownerId) {
      throw AppError.validation(
        'The owner is already a collaborator',
        undefined,
        'COLLABORATOR_IS_OWNER',
      );
    }
    const role = input.role ?? PlaylistCollaboratorRole.EDITOR;
    if (!Object.values(PlaylistCollaboratorRole).includes(role)) {
      throw AppError.validation(
        `role must be one of: ${Object.values(PlaylistCollaboratorRole).join(', ')}`,
        undefined,
        'COLLABORATOR_ROLE_INVALID',
      );
    }

    const existing = await this.collaboratorRepo.findOneBy({
      playlistId,
      userId: input.userId,
    });
    if (existing) {
      throw AppError.conflict('This user is already a collaborator on this playlist');
    }

    const collaborator = this.collaboratorRepo.create({
      playlistId,
      userId: input.userId,
      role,
    });
    return this.collaboratorRepo.save(collaborator);
  }

  /**
   * Change a collaborator's role. Only the owner may update roles.
   */
  async updateCollaboratorRole(
    playlistId: string,
    ownerId: string,
    userId: string,
    role: PlaylistCollaboratorRole,
  ): Promise<PlaylistCollaborator> {
    await this.getOwnedPlaylist(playlistId, ownerId);
    if (!Object.values(PlaylistCollaboratorRole).includes(role)) {
      throw AppError.validation(
        `role must be one of: ${Object.values(PlaylistCollaboratorRole).join(', ')}`,
        undefined,
        'COLLABORATOR_ROLE_INVALID',
      );
    }

    const collaborator = await this.collaboratorRepo.findOneBy({ playlistId, userId });
    if (!collaborator) {
      throw AppError.notFound('Collaborator not found on this playlist');
    }
    collaborator.role = role;
    return this.collaboratorRepo.save(collaborator);
  }

  /**
   * Remove a collaborator. The owner may remove anyone; a collaborator may
   * remove themselves.
   */
  async removeCollaborator(playlistId: string, requesterId: string, userId: string): Promise<void> {
    const playlist = await this.playlistRepo.findOneBy({ id: playlistId });
    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }

    const isOwner = playlist.userId === requesterId;
    if (!isOwner && requesterId !== userId) {
      throw AppError.authorization(
        'Only the owner can remove another collaborator',
        undefined,
        'COLLABORATOR_REMOVE_FORBIDDEN',
      );
    }

    const result = await this.collaboratorRepo.delete({ playlistId, userId });
    if (!result.affected) {
      throw AppError.notFound('Collaborator not found on this playlist');
    }
  }

  /**
   * Resolve the current matching songs for a rule-based playlist and shape
   * them like stored PlaylistSong rows so the API response stays uniform.
   */
  private async resolveRuleSongs(playlist: Playlist): Promise<PlaylistSong[]> {
    const rule = playlist.rule ?? {};
    const qb = this.songRepo
      .createQueryBuilder('song')
      .where('song.status = :status', { status: 'ready' })
      .andWhere('song.flagged = false');

    if (Array.isArray(rule.genres) && rule.genres.length > 0) {
      qb.andWhere('song.genre IN (:...genres)', { genres: rule.genres });
    }

    if (Array.isArray(rule.tags) && rule.tags.length > 0) {
      qb.innerJoin('song_tags', 'st', 'st."songId" = song.id')
        .innerJoin('tags', 'tags', 'tags.id = st."tagId"')
        .andWhere('tags.name IN (:...tags)', { tags: rule.tags });
    }

    if (typeof rule.savedWithinDays === 'number' && rule.savedWithinDays > 0) {
      const since = new Date(Date.now() - rule.savedWithinDays * DAY_MS);
      qb.andWhere('song."createdAt" >= :since', { since });
    }

    qb.orderBy('song."createdAt"', 'DESC').distinct(true);

    const songs = await qb.getMany();
    return songs.map((song, position) =>
      this.playlistSongRepo.create({
        playlistId: playlist.id,
        songId: song.id,
        position,
        song,
        addedAt: song.createdAt,
      }),
    );
  }

  /**
   * Load a playlist and verify the user owns it. Used for destructive and
   * collaborator-management operations.
   */
  private async getOwnedPlaylist(playlistId: string, userId: string): Promise<Playlist> {
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

  /**
   * Load a playlist and verify the user may edit it (owner or editor
   * collaborator). Used for metadata and song mutations.
   */
  private async getEditablePlaylist(playlistId: string, userId: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOneBy({ id: playlistId });
    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }
    const editable =
      playlist.userId === userId || (await this.isEditorCollaborator(playlistId, userId));
    if (!editable) {
      throw AppError.authorization(
        'You do not have edit access to this playlist',
        undefined,
        'NOT_PLAYLIST_EDITOR',
      );
    }
    return playlist;
  }

  /**
   * Load a playlist and verify the user may read it. Owner, editor/viewer
   * collaborators, and the public (for public playlists) may read.
   */
  private async getReadablePlaylist(playlistId: string, viewerId?: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOneBy({ id: playlistId });
    if (!playlist) {
      throw AppError.notFound('Playlist not found', undefined, 'PLAYLIST_NOT_FOUND');
    }
    if (!(await this.canRead(playlist, viewerId))) {
      throw AppError.authorization(
        'You do not have access to this playlist',
        undefined,
        'PLAYLIST_PRIVATE',
      );
    }
    return playlist;
  }

  private async canRead(playlist: Playlist, viewerId?: string): Promise<boolean> {
    if (playlist.isPublic) return true;
    if (!viewerId) return false;
    if (playlist.userId === viewerId) return true;
    return this.isCollaborator(playlist.id, viewerId);
  }

  private async isCollaborator(playlistId: string, userId: string): Promise<boolean> {
    const collaborator = await this.collaboratorRepo.findOneBy({ playlistId, userId });
    return !!collaborator;
  }

  private async isEditorCollaborator(playlistId: string, userId: string): Promise<boolean> {
    const collaborator = await this.collaboratorRepo.findOneBy({
      playlistId,
      userId,
      role: PlaylistCollaboratorRole.EDITOR,
    });
    return !!collaborator;
  }

  private assertValidRule(isRuleBased: boolean, rule?: PlaylistRule | null): void {
    if (!isRuleBased) return;
    const r = rule ?? {};
    const hasCriteria =
      (Array.isArray(r.tags) && r.tags.length > 0) ||
      (Array.isArray(r.genres) && r.genres.length > 0) ||
      (typeof r.savedWithinDays === 'number' && r.savedWithinDays > 0);
    if (!hasCriteria) {
      throw AppError.validation(
        'A rule-based playlist requires at least one criterion (tags, genres, or savedWithinDays)',
        undefined,
        'PLAYLIST_RULE_EMPTY',
      );
    }
    if (
      typeof r.savedWithinDays === 'number' &&
      (!Number.isInteger(r.savedWithinDays) || r.savedWithinDays <= 0)
    ) {
      throw AppError.validation(
        'savedWithinDays must be a positive integer',
        undefined,
        'PLAYLIST_RULE_INVALID',
      );
    }
  }
}
