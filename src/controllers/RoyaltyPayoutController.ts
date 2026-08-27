import { Request, Response } from 'express';
import { RoyaltyPayoutService } from '../services/RoyaltyPayoutService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const royaltyPayoutService = new RoyaltyPayoutService();

export class RoyaltyPayoutController {
  static exportHistory = async (req: Request, res: Response) => {
    try {
      const artistId = (req as any).user?.id as string;
      if (!artistId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const csvData = await royaltyPayoutService.exportHistory(artistId);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="royalty-payouts.csv"');
      return res.status(200).send(csvData);
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
