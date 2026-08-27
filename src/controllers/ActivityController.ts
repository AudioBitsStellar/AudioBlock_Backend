import { Request, Response } from 'express';
import { ActivityService } from '../services/ActivityService';
import { HTTP_STATUS } from '../config/constants';

export class ActivityController {
  private activityService: ActivityService;

  constructor() {
    this.activityService = new ActivityService();
  }

  public getFeed = async (req: Request, res: Response): Promise<void> => {
    const followingOnly = req.query.followingOnly === 'true' || req.query.followingOnly === '1';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const userId = (req as any).user?.id;

    const result = await this.activityService.getActivityFeed(userId, followingOnly, limit, offset);

    res.status(HTTP_STATUS.OK).json(result);
  };
}
