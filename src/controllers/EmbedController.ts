import { Request, Response } from 'express';
import { EmbedService } from '../services/EmbedService';
import { handleError } from '../utils/helpers';

const embedService = new EmbedService();

export class EmbedController {
  static getSongEmbed = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
      const data = await embedService.getSongEmbed(songId, clientIp);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.statusCode === 429) {
        return res.status(429).json({ success: false, message: 'Too many requests' });
      }
      handleError(res, error);
    }
  };

  static getAlbumEmbed = async (req: Request, res: Response) => {
    try {
      const albumId = req.params.id as string;
      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
      const data = await embedService.getAlbumEmbed(albumId, clientIp);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      handleError(res, error);
    }
  };
}
