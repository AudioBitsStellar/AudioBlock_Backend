import { Request, Response } from 'express';
import logger from '../config/logger';
import { SubgraphQueryResult, SubgraphQueryService } from '../services/SubgraphQueryService';

const subgraphQueryService = new SubgraphQueryService();
const MAX_QUERY_LIMIT = 1000;

function parseLimit(value: unknown): number | null {
  if (value === undefined) return 100;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_QUERY_LIMIT ? limit : null;
}

export class SubgraphController {
  private static async respond<T>(
    res: Response,
    query: () => Promise<SubgraphQueryResult<T>>,
  ): Promise<void> {
    try {
      const result = await query();
      res.status(result.error ? 502 : 200).json({ success: !result.error, ...result });
    } catch (error) {
      logger.error({ err: error }, 'Subgraph API query failed');
      res.status(502).json({ success: false, error: 'Subgraph query failed' });
    }
  }

  private static getLimit(req: Request, res: Response): number | null {
    const limit = parseLimit(req.query.limit);
    if (limit === null) {
      res.status(400).json({
        success: false,
        error: `limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`,
      });
    }
    return limit;
  }

  static artists = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;
    await SubgraphController.respond(res, () => subgraphQueryService.queryArtists(limit));
  };

  static songs = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;
    await SubgraphController.respond(res, () => subgraphQueryService.querySongs(limit));
  };

  static artist = async (req: Request, res: Response): Promise<void> => {
    await SubgraphController.respond(res, () =>
      subgraphQueryService.queryArtistHierarchy(req.params.artistId),
    );
  };

  static sales = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;
    await SubgraphController.respond(res, () => subgraphQueryService.querySales(limit));
  };

  static transfers = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;
    await SubgraphController.respond(res, () => subgraphQueryService.queryTransfers(limit));
  };

  static mints = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;
    await SubgraphController.respond(res, () => subgraphQueryService.queryMints(limit));
  };

  static trackEngagement = async (req: Request, res: Response): Promise<void> => {
    await SubgraphController.respond(res, () =>
      subgraphQueryService.queryTrackEngagement(req.params.songId),
    );
  };

  static aggregate = async (req: Request, res: Response): Promise<void> => {
    const limit = SubgraphController.getLimit(req, res);
    if (limit === null) return;

    try {
      const [artists, songs, sales, transfers, mints] = await Promise.all([
        subgraphQueryService.queryArtists(limit),
        subgraphQueryService.querySongs(limit),
        subgraphQueryService.querySales(limit),
        subgraphQueryService.queryTransfers(limit),
        subgraphQueryService.queryMints(limit),
      ]);
      const results = { artists, songs, sales, transfers, mints };
      const success = Object.values(results).every((result) => result.error === null);
      res.status(success ? 200 : 502).json({ success, data: results });
    } catch (error) {
      logger.error({ err: error }, 'Subgraph aggregate query failed');
      res.status(502).json({ success: false, error: 'Subgraph aggregate query failed' });
    }
  };

  static health = async (_req: Request, res: Response): Promise<void> => {
    try {
      const report = await subgraphQueryService.getHealthReport();
      res.status(report.subgraphHealthy ? 200 : 503).json({
        success: report.subgraphHealthy,
        data: report,
      });
    } catch (error) {
      logger.error({ err: error }, 'Subgraph health query failed');
      res.status(503).json({ success: false, error: 'Subgraph health query failed' });
    }
  };
}
