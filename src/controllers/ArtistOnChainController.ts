import { Request, Response } from "express";
import { ArtistService } from "../services/Artist/ArtistService";
import { handleError } from "../utils/helpers";

export class ArtistOnChainController {
  private artistService: ArtistService;

  constructor() {
    this.artistService = new ArtistService();
  }

  connectWallet = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { stellarPublicKey } = req.body;
      const user = await this.artistService.connectStellarWallet(userId, stellarPublicKey);
      return res.status(200).json({ success: true, data: { stellarPublicKey: user.stellarPublicKey } });
    } catch (error) {
      handleError(res, error);
    }
  };

  prepareSetup = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { cid } = req.body;
      const prepared = await this.artistService.prepareArtistOnChainSetup(userId, cid);
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(res, error);
    }
  };

  submitSetup = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { signedXdr } = req.body;
      const result = await this.artistService.submitArtistOnChainSetup(userId, signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleError(res, error);
    }
  };
}
