import { Request, Response } from 'express';
import { ArtistMetadataService } from '../services/ArtistMetadataService';
import { handleError } from '../utils/helpers';

const metadataService = new ArtistMetadataService();

export class ArtistMetadataController {
  static getMetadata = async (req: Request, res: Response) => {
    try {
      const artistId = (req.params.id || req.params.artistId) as string;
      if (!artistId)
        return res.status(400).json({ success: false, message: 'artistId is required' });

      const data = await metadataService.getArtistMetadata(artistId);

      // If client requests HTML fragment (e.g., ?format=html), return OG tags HTML
      if (req.query.format === 'html') {
        const htmlFragment = await metadataService.getArtistMetadataHtml(artistId);
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(htmlFragment);
      }

      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.message === 'Artist not found') {
        return res.status(404).json({ success: false, message: 'Artist not found' });
      }
      handleError(res, error);
    }
  };
}
