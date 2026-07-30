import { Request, Response } from 'express';
import { SaveService } from '../services/SaveService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';

/**
 * Controller for song save/bookmark and library endpoints (Issue #91).
 */
export class SaveController {
  private saveService: SaveService;

  constructor() {
    this.saveService = new SaveService();
  }

  /**
   * Save a song to the caller's library. Idempotent — saving twice returns 200
   * with `alreadySaved: true` rather than creating a duplicate or erroring.
   * POST /api/songs/:id/save
   */
  saveSong = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const { save, alreadySaved } = await this.saveService.saveSong(
        userId,
        routeParam(req.params.id),
        req.body?.collection,
      );

      res.status(alreadySaved ? HTTP_STATUS.OK : HTTP_STATUS.CREATED).json({
        message: alreadySaved ? 'Song already saved' : 'Song saved to library',
        alreadySaved,
        isSaved: true,
        save: {
          id: save.id,
          songId: save.songId,
          collection: save.collection,
          savedAt: save.createdAt,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Remove a song from the caller's library. Without a `collection` query
   * parameter the song is removed from every collection.
   * DELETE /api/songs/:id/save?collection=Later
   */
  unsaveSong = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const collection =
        typeof req.query.collection === 'string' ? req.query.collection : undefined;

      const removed = await this.saveService.unsaveSong(
        userId,
        routeParam(req.params.id),
        collection,
      );

      res.status(HTTP_STATUS.OK).json({
        message: 'Song removed from library',
        removed,
        isSaved: false,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List the caller's saved songs.
   * GET /api/users/me/library?page=1&limit=20&collection=Favorites
   */
  getMyLibrary = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const collection =
        typeof req.query.collection === 'string' ? req.query.collection : undefined;

      const library = await this.saveService.getUserLibrary(userId, page, limit, collection);

      res.status(HTTP_STATUS.OK).json(library);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List the caller's collections with their sizes.
   * GET /api/users/me/library/collections
   */
  getMyCollections = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const collections = await this.saveService.getUserCollections(userId);

      res.status(HTTP_STATUS.OK).json({ collections, total: collections.length });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Report whether the caller has saved a song.
   * GET /api/songs/:id/save
   */
  getSaveStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const isSaved = await this.saveService.hasUserSaved(userId, routeParam(req.params.id));

      res.status(HTTP_STATUS.OK).json({ songId: routeParam(req.params.id), isSaved });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
