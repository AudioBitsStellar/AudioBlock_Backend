import { Request, Response } from 'express';
import { AlbumService } from '../services/AlbumService';
import { handleError } from '../utils/helpers';

const albumService = new AlbumService();

export class AlbumController {
  static list = async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const artistId = (req.query.artistId as string) || undefined;

      const result = await albumService.findPaginated(page, limit, artistId);

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

export default AlbumController;
