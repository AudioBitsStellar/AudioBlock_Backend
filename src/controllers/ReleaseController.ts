import { Request, Response } from 'express';
import { ReleaseService } from '../services/ReleaseService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const releaseService = new ReleaseService();

export class ReleaseController {
  static create = async (req: Request, res: Response) => {
    try {
      const artistId = (req as any).user.id as string;
      const { title, releaseDate, type, coverArt, songIds } = req.body;

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

      const result = await releaseService.findPaginated(page, limit, artistId);
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
      const { title, releaseDate, type, coverArt } = req.body;

      const release = await releaseService.update(releaseId, requesterId, {
        title,
        releaseDate,
        type,
        coverArt,
      });
      return res.status(200).json({ success: true, data: release });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
