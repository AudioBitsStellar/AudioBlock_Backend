import { Request, Response } from 'express';
import { PlaylistService } from '../services/PlaylistService';
import { PlaylistCollaboratorRole } from '../entities/PlaylistCollaborator';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const playlistService = new PlaylistService();

export class PlaylistController {
  /** POST /api/playlists — create a playlist. */
  static create = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const { name, description, isPublic, coverImageUrl, isRuleBased, rule } = req.body;
      const playlist = await playlistService.create(userId, {
        name,
        description,
        isPublic,
        coverImageUrl,
        isRuleBased,
        rule,
      });
      return res.status(201).json({ success: true, data: playlist });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/playlists — list the caller's playlists. */
  static list = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const result = await playlistService.listForUser(userId, page, limit);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/playlists/:id — get a playlist with its ordered songs. */
  static getById = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const viewerId = (req as any).user?.id as string | undefined;
      const playlist = await playlistService.getById(playlistId, viewerId);
      return res.status(200).json({ success: true, data: playlist });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/playlists/:id — update playlist metadata. */
  static update = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const userId = (req as any).user.id as string;
      const { name, description, isPublic, coverImageUrl, isRuleBased, rule } = req.body;

      if (Object.keys(req.body ?? {}).length === 0) {
        throw AppError.validation('Nothing to update', undefined, 'PLAYLIST_EMPTY_UPDATE');
      }

      const playlist = await playlistService.update(playlistId, userId, {
        name,
        description,
        isPublic,
        coverImageUrl,
        isRuleBased,
        rule,
      });
      return res.status(200).json({ success: true, data: playlist });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/playlists/:id — delete a playlist. */
  static remove = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const userId = (req as any).user.id as string;
      await playlistService.remove(playlistId, userId);
      return res.status(200).json({ success: true, message: 'Playlist deleted' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/playlists/:id/songs — add a song to a playlist. */
  static addSong = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const userId = (req as any).user.id as string;
      const songId = (req.body?.songId ?? req.body?.id) as string | undefined;

      if (!songId) {
        throw AppError.validation('songId is required', undefined, 'SONG_ID_REQUIRED');
      }

      const entry = await playlistService.addSong(playlistId, userId, songId);
      return res.status(201).json({ success: true, data: entry });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/playlists/:id/songs/:songId — remove a song from a playlist. */
  static removeSong = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const songId = req.params.songId as string;
      const userId = (req as any).user.id as string;

      await playlistService.removeSong(playlistId, userId, songId);
      return res.status(200).json({ success: true, message: 'Song removed from playlist' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/playlists/:id/reorder — reorder the songs in a playlist. */
  static reorder = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const userId = (req as any).user.id as string;
      const songIds = req.body?.songIds as string[] | undefined;

      if (!Array.isArray(songIds)) {
        throw AppError.validation(
          'songIds must be an array of song ids',
          undefined,
          'PLAYLIST_REORDER_INVALID',
        );
      }

      const playlist = await playlistService.reorder(playlistId, userId, songIds);
      return res.status(200).json({ success: true, data: playlist });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PATCH /api/playlists/:id/songs/:songId/position — move one song (Issue #409). */
  static moveSong = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const songId = req.params.songId as string;
      const userId = (req as any).user.id as string;
      const newPosition = req.body?.newPosition as number | undefined;

      if (newPosition === undefined || !Number.isInteger(newPosition) || newPosition < 0) {
        throw AppError.validation(
          'newPosition must be a non-negative integer',
          undefined,
          'PLAYLIST_REORDER_INVALID',
        );
      }

      const playlist = await playlistService.moveSong(playlistId, userId, songId, newPosition);
      return res.status(200).json({ success: true, data: playlist });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/playlists/:id/follow — follow a playlist (Issue #408). */
  static followPlaylist = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const playlistId = req.params.id as string;
      const result = await playlistService.followPlaylist(userId, playlistId);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/playlists/:id/follow — unfollow a playlist (Issue #408). */
  static unfollowPlaylist = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const playlistId = req.params.id as string;
      await playlistService.unfollowPlaylist(userId, playlistId);
      return res.status(200).json({ success: true, message: 'Playlist unfollowed' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/playlists/followed — list the caller's followed playlists (Issue #408). */
  static listFollowedPlaylists = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const result = await playlistService.listFollowedPlaylists(userId, page, limit);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/playlists/:id/collaborators — list a playlist's collaborators. */
  static listCollaborators = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const viewerId = (req as any).user.id as string;
      const collaborators = await playlistService.listCollaborators(playlistId, viewerId);
      return res.status(200).json({ success: true, data: collaborators });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/playlists/:id/collaborators — invite a collaborator (owner only). */
  static addCollaborator = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const userId = (req as any).user.id as string;
      const role =
        (req.body?.role as PlaylistCollaboratorRole | undefined) ?? PlaylistCollaboratorRole.EDITOR;
      const collaborator = await playlistService.addCollaborator(playlistId, userId, {
        userId: req.body?.userId as string,
        role,
      });
      return res.status(201).json({ success: true, data: collaborator });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/playlists/:id/collaborators/:userId — update a collaborator's role (owner only). */
  static updateCollaboratorRole = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const ownerId = (req as any).user.id as string;
      const targetUserId = req.params.userId as string;
      const role = req.body?.role as PlaylistCollaboratorRole;
      const collaborator = await playlistService.updateCollaboratorRole(
        playlistId,
        ownerId,
        targetUserId,
        role,
      );
      return res.status(200).json({ success: true, data: collaborator });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/playlists/:id/collaborators/:userId — remove a collaborator. */
  static removeCollaborator = async (req: Request, res: Response) => {
    try {
      const playlistId = req.params.id as string;
      const requesterId = (req as any).user.id as string;
      const targetUserId = req.params.userId as string;
      await playlistService.removeCollaborator(playlistId, requesterId, targetUserId);
      return res.status(200).json({ success: true, message: 'Collaborator removed' });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
