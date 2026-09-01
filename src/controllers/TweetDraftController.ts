import { Request, Response } from 'express';
import { TweetDraftService } from '../services/TweetDraftService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { routeParam } from '../utils/routeParams';

const tweetDraftService = new TweetDraftService();

/**
 * Draft-tweet endpoints for twitterRoutes.ts (issue: "add drafting
 * assistance... requiring explicit artist approval before posting").
 */
export class TweetDraftController {
  createDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const songId = req.body?.songId as string | undefined;

      const draft = await tweetDraftService.createDraft(userId, songId);
      res.status(HTTP_STATUS.CREATED).json({ success: true, data: draft });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  listDrafts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const drafts = await tweetDraftService.listDrafts(userId);
      res.status(HTTP_STATUS.OK).json({ success: true, data: drafts });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  approveDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const draftId = routeParam(req.params.id);

      const draft = await tweetDraftService.approveDraft(userId, draftId);
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message:
          'Draft approved. Post it from your Twitter account — AudioBlock does not post on your behalf.',
        data: draft,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  discardDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.id as string;
      const draftId = routeParam(req.params.id);

      await tweetDraftService.discardDraft(userId, draftId);
      res.status(HTTP_STATUS.OK).json({ success: true, message: 'Draft discarded' });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
