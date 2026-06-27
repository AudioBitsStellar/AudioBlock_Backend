import { Request, Response } from "express";
import { MarketplaceService } from "../services/Marketplace/MarketplaceService";
import { handleError } from "../utils/helpers";

const marketplaceService = new MarketplaceService();

export class MarketplaceController {
  static prepareListing = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId, priceInStroops } = req.body;
      if (!stellarPublicKey) {
        return res.status(400).json({ message: "Connect a Stellar wallet before listing" });
      }
      const prepared = await marketplaceService.prepareListing(
        stellarPublicKey,
        Number(tokenId),
        Number(priceInStroops)
      );
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(res, error);
    }
  };

  static submitListing = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const result = await marketplaceService.submitListing(signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(res, error);
    }
  };

  static prepareBuy = async (req: Request, res: Response) => {
    try {
      const stellarPublicKey = (req as any).user?.stellarPublicKey as string;
      const { tokenId } = req.body;
      if (!stellarPublicKey) {
        return res.status(400).json({ message: "Connect a Stellar wallet before buying" });
      }
      const prepared = await marketplaceService.prepareBuy(
        stellarPublicKey,
        Number(tokenId)
      );
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(res, error);
    }
  };

  static submitBuy = async (req: Request, res: Response) => {
    try {
      const { signedXdr } = req.body;
      const result = await marketplaceService.submitBuy(signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(res, error);
    }
  };
}
