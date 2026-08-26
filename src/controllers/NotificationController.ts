import { Request, Response } from 'express';
import { NotificationService } from '../services/NotificationService';
import { handleError } from '../utils/helpers';

const notificationService = new NotificationService();

export class NotificationController {
  /** GET /api/notifications — the caller's notifications, paginated. */
  static list = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const result = await notificationService.listForUser(userId, page, limit);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/notifications/:id/read — mark one notification as read. */
  static markAsRead = async (req: Request, res: Response) => {
    try {
      const notificationId = req.params.id as string;
      const userId = (req as any).user.id as string;

      const notification = await notificationService.markAsRead(notificationId, userId);
      return res.status(200).json({ success: true, data: notification });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/notifications/read-all — mark every notification as read. */
  static markAllAsRead = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;

      const result = await notificationService.markAllAsRead(userId);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
