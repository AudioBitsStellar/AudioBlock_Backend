import { Request, Response } from 'express';
import { AlbumService } from '../services/AlbumService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const albumService = new AlbumService();

export class AlbumController {
  static list = async (req: Request, res: Response) => {
    try {
      const parsePositiveInt = (value: unknown, field: 'page' | 'limit', fallback: number) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || !/^\d+$/.test(value)) {
          throw AppError.validation(`${field} must be a positive integer`, [
            { field, value, constraint: 'positive integer' },
          ]);
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
          throw AppError.validation(`${field} must be a positive integer`, [
            { field, value, constraint: 'positive integer' },
          ]);
        }
        return parsed;
      };

      const page = parsePositiveInt(req.query.page, 'page', 1);
      const limit = Math.min(parsePositiveInt(req.query.limit, 'limit', 20), 100);
      const artistId =
        typeof req.query.artistId === 'string' && req.query.artistId.trim()
          ? req.query.artistId.trim()
          : undefined;

      const result = await albumService.findPaginated(page, limit, artistId);

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}

export default AlbumController;
