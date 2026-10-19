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

  /** GET /api/notifications/preferences — get caller's notification preferences. */
  static getPreferences = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const preferences = await notificationService.getPreferences(userId);
      return res.status(200).json({ success: true, data: preferences });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/notifications/preferences — update notification preferences. */
  static updatePreferences = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id as string;
      const body = req.body;

      let normalized: Array<{ type: string; enabled: boolean }> = [];
      if (Array.isArray(body.preferences)) {
        normalized = body.preferences;
      } else if (body.type !== undefined && body.enabled !== undefined) {
        normalized = [{ type: body.type, enabled: Boolean(body.enabled) }];
      } else if (typeof body.preferences === 'object' && body.preferences !== null) {
        normalized = Object.entries(body.preferences).map(([type, enabled]) => ({
          type,
          enabled: Boolean(enabled),
        }));
      }

      const updated = await notificationService.updatePreferences(userId, normalized);
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
