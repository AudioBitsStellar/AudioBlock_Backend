import { Request, Response } from 'express';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { UserFollow } from '../entities/UserFollow';
import { ActivityService } from '../services/ActivityService';
import { AppError } from '../errors/AppError';
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

  static async getActivityFeed(req: Request, res: Response): Promise<void> {
    try {
      const feedRepo = AppDataSource.getRepository(ActivityFeed);
      const followRepo = AppDataSource.getRepository(UserFollow);

      const mode = req.query.mode as string;
      const userId = (req as any).user?.id;

      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
      const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
      const skip = (page - 1) * limit;

      if (mode === 'following') {
        if (!userId) {
          throw AppError.authentication('Authentication required for following feed');
        }

        const follows = await followRepo.find({
          where: { followerId: userId },
          select: ['followingId'],
        });

        const followingIds = follows.map((f) => f.followingId);

        if (followingIds.length === 0) {
          res.status(200).json({
            page,
            limit,
            total: 0,
            data: [],
          });
          return;
        }

        const [items, total] = await feedRepo
          .createQueryBuilder('activity')
          .where('activity.userId IN (:...followingIds)', { followingIds })
          .orderBy('activity.createdAt', 'DESC')
          .skip(skip)
          .take(limit)
          .getManyAndCount();


        res.status(200).json({
          page,
          limit,
          total,
          data: items,
        });
        return;
      }

      const [items, total] = await feedRepo.findAndCount({
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });

      res.status(200).json({
        page,
        limit,
        total,
        data: items,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  }
}
