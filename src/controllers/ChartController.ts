import { Request, Response } from 'express';
import { ChartService, ChartWindow } from '../services/ChartService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const chartService = new ChartService();
const VALID_WINDOWS: ChartWindow[] = ['24h', '7d', '30d'];

export class ChartController {
  static getTrending = async (req: Request, res: Response) => {
    try {
      const window = (req.query.window as string) || '7d';
      if (!VALID_WINDOWS.includes(window as ChartWindow)) {
        throw AppError.validation(`window must be one of: ${VALID_WINDOWS.join(', ')}`);
      }

      const genre = (req.query.genre as string) || undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const data = await chartService.getTrending(window as ChartWindow, genre, limit);

      return res.status(200).json({
        success: true,
        window,
        genre: genre || null,
        data,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
