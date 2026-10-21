import { Request, Response } from 'express';
import { ReleaseService } from '../services/ReleaseService';
import { PreSaveService } from '../services/PreSaveService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const releaseService = new ReleaseService();

export class ReleaseController {
  static create = async (req: Request, res: Response) => {
    try {
      const artistId = (req as any).user.id as string;
      const { title, releaseDate, type, coverArt, songIds, scheduledAt, status } = req.body;

      if (!title || !releaseDate || !type) {
        throw AppError.validation('title, releaseDate, and type are required');
      }

      const release = await releaseService.create({
        title,
        artistId,
        releaseDate,
        type,
        coverArt,
        songIds,
        scheduledAt,
        status,
      });
      return res.status(201).json({ success: true, data: release });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const artistId = (req.query.artistId as string) || undefined;
      const status = (req.query.status as any) || undefined;

      const result =
        status !== undefined
          ? await releaseService.findPaginated(page, limit, artistId, status)
          : await releaseService.findPaginated(page, limit, artistId);
      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static getById = async (req: Request, res: Response) => {
    try {
      const release = await releaseService.getById(req.params.id as string);
      return res.status(200).json({ success: true, data: release });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static update = async (req: Request, res: Response) => {
    try {
      const releaseId = req.params.id as string;
      const requesterId = (req as any).user.id as string;
      const { title, releaseDate, type, coverArt, scheduledAt, status } = req.body;

      const release = await releaseService.update(releaseId, requesterId, {
        title,
        releaseDate,
        type,
        coverArt,
        scheduledAt,
        status,
      });
      return res.status(200).json({ success: true, data: release });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/releases/:id/publish — manually publish a release immediately (Issue #423). */
  static publish = async (req: Request, res: Response) => {
    try {
      const releaseId = req.params.id as string;
      const artistId = (req as any).user.id as string;

      const release = await releaseService.publish(releaseId, artistId);
      return res.status(200).json({ success: true, data: release });
  /**
   * Pre-save an upcoming release (Issue #424).
   * POST /api/releases/:id/presave — records interest before publish.
   * Idempotent: pre-saving twice returns 200 with `alreadyPreSaved: true`.
   */
  static preSave = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        throw AppError.authentication('User not authenticated');
      }

      const { preSave, alreadyPreSaved } = await new PreSaveService().preSave(
        userId,
        req.params.id as string,
      );
      return res.status(alreadyPreSaved ? 200 : 201).json({
        success: true,
        alreadyPreSaved,
        isPreSaved: true,
        data: preSave,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/releases/:id/presave — cancel a pre-save. */
  static unPreSave = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        throw AppError.authentication('User not authenticated');
      }

      await new PreSaveService().unPreSave(userId, req.params.id as string);
      return res.status(200).json({ success: true, isPreSaved: false });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/releases/:id/presave — pre-save status and total interest. */
  static getPreSaveStatus = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        throw AppError.authentication('User not authenticated');
      }

      const status = await new PreSaveService().getStatus(userId, req.params.id as string);
      return res.status(200).json({ success: true, data: status });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Publish an upcoming release immediately (Issue #424).
   * POST /api/releases/:id/publish — owner-only; pre-saved releases
   * auto-appear in each fan's library at publish time.
   */
  static publish = async (req: Request, res: Response) => {
    try {
      const requesterId = (req as any).user?.id as string | undefined;
      if (!requesterId) {
        throw AppError.authentication('User not authenticated');
      }

      const { release, fulfilled, savesCreated } = await releaseService.publish(
        req.params.id as string,
        requesterId,
      );
      return res.status(200).json({ success: true, data: release, fulfilled, savesCreated });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
