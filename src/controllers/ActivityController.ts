import { Request, Response } from 'express';
import { ActivityService } from '../services/ActivityService';
import { HTTP_STATUS } from '../config/constants';

export class ActivityController {
  static getMyFeed = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const cursor = req.query.cursor as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const type = req.query.type as string | string[];

      const activities = await activityService.getFeed(userId, cursor, limit, type);
      return res.status(200).json({ success: true, data: activities });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static getUserActivities = async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      const cursor = req.query.cursor as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const type = req.query.type as string | string[];

      const activities = await activityService.getUserActivities(userId, cursor, limit, type);
      return res.status(200).json({ success: true, data: activities });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
