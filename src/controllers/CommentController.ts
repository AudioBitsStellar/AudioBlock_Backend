import { Request, Response } from 'express';
import { CommentService } from '../services/CommentService';
import { CommentReportService } from '../services/CommentReportService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';

/**
 * Controller for song comment endpoints (Issue #90) and comment flagging
 * (Issue #411).
 */
export class CommentController {
  private commentService: CommentService;
  private reportService: CommentReportService;

  constructor() {
    this.commentService = new CommentService();
    this.reportService = new CommentReportService();
  }

  /**
   * Create a comment on a song, or a reply when `parentId` is supplied.
   * POST /api/songs/:id/comments
   */
  createComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const { text, parentId } = req.body;

      const comment = await this.commentService.createComment(
        userId,
        routeParam(req.params.id),
        text,
        parentId,
      );

      res.status(HTTP_STATUS.CREATED).json({ message: 'Comment created successfully', comment });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List a song's top-level comments with reply counts.
   * GET /api/songs/:id/comments?page=1&limit=20
   */
  getSongComments = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await this.commentService.getSongComments(
        routeParam(req.params.id),
        page,
        limit,
      );

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List direct replies to a comment.
   * GET /api/comments/:id/replies?page=1&limit=20
   */
  getReplies = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await this.commentService.getReplies(routeParam(req.params.id), page, limit);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Edit the caller's own comment, within the 15-minute edit window.
   * PUT /api/comments/:id
   */
  updateComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const comment = await this.commentService.updateComment(
        userId,
        routeParam(req.params.id),
        req.body.text,
      );

      res.status(HTTP_STATUS.OK).json({ message: 'Comment updated successfully', comment });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Delete the caller's own comment. Replies are removed with it.
   * DELETE /api/comments/:id
   */
  deleteComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      await this.commentService.deleteComment(userId, routeParam(req.params.id));

      res.status(HTTP_STATUS.OK).json({ message: 'Comment deleted successfully' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Flag a comment so it surfaces in the moderation queue (Issue #411).
   * POST /api/comments/:id/report
   */
  reportComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const reporterId = (req as any).user?.id as string | undefined;

      if (!reporterId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const report = await this.reportService.submitReport(
        routeParam(req.params.id),
        reporterId,
        { reason: req.body.reason, description: req.body.description },
      );

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Comment reported successfully',
        report,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
