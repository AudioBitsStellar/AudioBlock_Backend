import { Request, Response } from 'express';
import { PlaylistService } from '../services/PlaylistService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const playlistService = new PlaylistService();

export class PlaylistController {
  /** POST /api/playlists — create a playlist. */
  static create = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const { name, description, isPublic, coverImageUrl } = req.body;
      const playlist = await playlistService.create(userId, {
        name,
        description,
        isPublic,
        coverImageUrl,
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
      const { name, description, isPublic, coverImageUrl } = req.body;

      if (Object.keys(req.body ?? {}).length === 0) {
        throw AppError.validation('Nothing to update', undefined, 'PLAYLIST_EMPTY_UPDATE');
      }

      const playlist = await playlistService.update(playlistId, userId, {
        name,
        description,
        isPublic,
        coverImageUrl,
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
}
