import { Request, Response } from 'express';
import { ActivityService } from '../services/ActivityService';
import { handleError } from '../utils/helpers';

const activityService = new ActivityService();

export class ActivityController {
  static getMyFeed = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const cursor = req.query.cursor as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      const activities = await activityService.getFeed(userId, cursor, limit);
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

      const activities = await activityService.getUserActivities(userId, cursor, limit);
      return res.status(200).json({ success: true, data: activities });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
