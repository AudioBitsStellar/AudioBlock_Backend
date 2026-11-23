import { Request, Response } from 'express';
import { ArtistAnalyticsExportService } from '../services/Song/ArtistAnalyticsExportService';
import { parseWindow } from '../services/Song/SongStatsService';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

const exportService = new ArtistAnalyticsExportService();

export class ArtistAnalyticsController {
  /**
   * GET /api/artist/analytics/export?window=7d|30d|90d|all-time — per-song CSV of
   * the caller's catalogue (#982).
   *
   * Auth: `authArtistMiddleware`. The export only ever covers songs the caller
   * owns, so the artist id comes from the token, never from the request.
   */
  static exportCsv = async (req: Request, res: Response) => {
    try {
      const artistId = (req as any).user?.id as string | undefined;
      if (!artistId) {
        throw AppError.authentication('User not authenticated');
      }

      const window = parseWindow(req.query.window);
      const csv = await exportService.buildCsv(artistId, window);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="artist-analytics-${window}.csv"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(csv);
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
