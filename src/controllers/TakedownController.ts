import { Request, Response } from 'express';
import { TakedownService } from '../services/TakedownService';
import { TakedownReason } from '../entities/TakedownRequest';
import { handleError } from '../utils/helpers';
import { getTakedownPolicy } from '../services/TakedownPolicyService';

const takedownService = new TakedownService();

export class TakedownController {
  /**
   * GET /api/takedown/policy — public takedown policy and DMCA designated-agent
   * details (#986). Requires no account, so rights holders can find the process.
   */
  static getPolicy = (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ success: true, data: getTakedownPolicy() });
  };

  static create = async (req: Request, res: Response) => {
    try {
      const requestedBy = (req as any).user?.id;
      if (!requestedBy) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const { songId, reason, description, evidenceUrl } = req.body;
      if (!songId) return res.status(400).json({ success: false, message: 'songId is required' });

      const takedown = await takedownService.createRequest(
        requestedBy,
        songId,
        (reason as TakedownReason) || TakedownReason.COPYRIGHT,
        description,
        evidenceUrl,
      );
      return res.status(201).json({ success: true, data: takedown });
    } catch (error: any) {
      if (error.statusCode === 404)
        return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const { status, songId, overdue } = req.query as any;
      // `?overdue=true` narrows to pending requests past their review deadline (#981).
      const data = await takedownService.listRequests({
        status,
        songId,
        overdue: overdue === 'true',
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      handleError(res, error);
    }
  };

  static getOne = async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const data = await takedownService.getRequest(id);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode === 404)
        return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };

  static review = async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user?.id;
      if (!adminId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const id = req.params.id as string;
      const { action, reviewNotes } = req.body;
      if (!action || !['approve', 'reject', 'reverse'].includes(action)) {
        return res
          .status(400)
          .json({ success: false, message: 'action must be approve|reject|reverse' });
      }
      const updated = await takedownService.reviewRequest(id, adminId, action, reviewNotes);
      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      if (error.statusCode === 404)
        return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };

  /**
   * POST /api/takedown/:id/counter-notice — the artist disputes an approved
   * takedown of their own song (#981). Ownership and deadlines are enforced by
   * the service.
   */
  static submitCounterNotice = async (req: Request, res: Response) => {
    try {
      const artistId = (req as any).user?.id;
      if (!artistId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const id = req.params.id as string;
      const { statement } = req.body;
      const data = await takedownService.submitCounterNotice(id, artistId, statement);
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode === 404)
        return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };
}
