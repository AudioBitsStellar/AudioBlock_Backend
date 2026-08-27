import { Request, Response } from 'express';
import { MarketplaceService } from '../services/Marketplace/MarketplaceService';
import { NotificationService } from '../services/NotificationService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';
import logger from '../config/logger';

const marketplaceService = new MarketplaceService();
const notificationService = new NotificationService();

export class MarketplaceController {
  static prepareListing = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId, priceInStroops } = req.body;
      if (!stellarPublicKey) {
        throw AppError.businessLogic(
          'Connect a Stellar wallet before listing',
          undefined,
          'WALLET_NOT_CONNECTED',
        );
      }
      const prepared = await marketplaceService.prepareListing(
        stellarPublicKey,
        Number(tokenId),
        Number(priceInStroops),
      );
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static submitListing = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const result = await marketplaceService.submitListing(signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static prepareBuy = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId } = req.body;
      if (!stellarPublicKey) {
        throw AppError.businessLogic(
          'Connect a Stellar wallet before buying',
          undefined,
          'WALLET_NOT_CONNECTED',
        );
      }
      const prepared = await marketplaceService.prepareBuy(stellarPublicKey, Number(tokenId));
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static submitBuy = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const userId = (req as any).user?.id as string | undefined;
      const result = await marketplaceService.submitBuy(signedXdr);

      // Notify the buyer that their purchase completed (Issue #79).
      // Best-effort: a notification failure must not fail the purchase.
      if (userId) {
        try {
          await notificationService.create({
            userId,
            type: 'marketplace_sale',
            title: 'Purchase completed',
            message: 'Your marketplace purchase was completed successfully.',
            data: { txHash: result.txHash },
          });
        } catch (err) {
          logger.warn({ err, userId }, 'Failed to create marketplace sale notification');
        }
      }

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
  static prepareAuction = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId, startingPriceInStroops, durationSeconds } = req.body;
      if (!stellarPublicKey) {
        throw AppError.businessLogic(
          'Connect a Stellar wallet before listing',
          undefined,
          'WALLET_NOT_CONNECTED',
        );
      }
      const prepared = await marketplaceService.prepareAuction(
        stellarPublicKey,
        Number(tokenId),
        Number(startingPriceInStroops),
        Number(durationSeconds)
      );
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static submitAuction = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const result = await marketplaceService.submitAuction(signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static prepareBid = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId, bidAmountInStroops } = req.body;
      if (!stellarPublicKey) {
        throw AppError.businessLogic(
          'Connect a Stellar wallet before bidding',
          undefined,
          'WALLET_NOT_CONNECTED',
        );
      }
      const prepared = await marketplaceService.prepareBid(stellarPublicKey, Number(tokenId), Number(bidAmountInStroops));
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static submitBid = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const result = await marketplaceService.submitBid(signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
