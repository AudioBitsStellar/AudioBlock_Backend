import { Request, Response } from 'express';
import { ActivityService } from '../services/ActivityService';

export class ActivityController {
  private activityService: ActivityService;

  constructor() {
    this.activityService = new ActivityService();
  }

  public getFeed = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    const mode = (req.query.mode as 'all' | 'following') || 'all';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const feed = await this.activityService.getActivityFeed({
      userId,
      mode,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      data: feed,
    });
  };
}
