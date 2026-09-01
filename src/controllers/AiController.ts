import { Request, Response } from 'express';
import { AiGenerationService } from '../services/ai/AiGenerationService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { routeParam } from '../utils/routeParams';

const aiGenerationService = new AiGenerationService();

/**
 * AI-assisted generation endpoints (cover art, descriptions). Slow AI
 * operations are queued via JobQueueService rather than run synchronously —
 * these routes only enqueue the job and return its pending record; the
 * result arrives via the `ai.generation.completed` webhook event or by
 * polling GET /api/ai/generations/:id.
 */
export class AiController {
  requestCoverArt = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const songId = routeParam(req.params.songId);

      const record = await aiGenerationService.requestGeneration('coverArt', songId, userId);
      res.status(HTTP_STATUS.CREATED).json({ success: true, data: record });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  requestDescription = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const songId = routeParam(req.params.songId);

      const record = await aiGenerationService.requestGeneration('descriptions', songId, userId);
      res.status(HTTP_STATUS.CREATED).json({ success: true, data: record });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getGeneration = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const recordId = routeParam(req.params.id);

      const record = await aiGenerationService.getRecord(recordId, userId);
      res.status(HTTP_STATUS.OK).json({ success: true, data: record });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
