import { Request, Response } from 'express';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { UserFollow } from '../entities/UserFollow';
import { Song } from '../entities/Song';
import { ActivityService } from '../services/ActivityService';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

const activityService = new ActivityService();

export class ActivityController {
  /**
   * GET /api/activity/onchain
   * Query indexed on-chain events with pagination and filters.
   */
  static getOnChainActivity = async (req: Request, res: Response) => {
    try {
      const contractType = req.query.contractType as string | undefined;
      const eventType = req.query.eventType as string | undefined;
      const address = req.query.address as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await activityService.getOnChainActivity({
        contractType,
        eventType,
        address,
        page,
        limit,
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

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
      const userId = req.params.id as string;
      const cursor = req.query.cursor as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const type = req.query.type as string | string[];

      const activities = await activityService.getUserActivities(userId, cursor, limit, type);
      return res.status(200).json({ success: true, data: activities });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * GET /api/activity?page=&limit=&mode=following&artistId=&type=
   *
   * Artist overview filter (Issue #846): pass `artistId` (aliases `artist`,
   * `artist_id`, `userId`, `user_id`) to scope the feed server-side to activity
   * involving the artist — rows authored by the artist (`userId = artistId`)
   * PLUS rows targeting their catalogue (`targetId IN (<owned songIds>)`) PLUS
   * follows of the artist (`actionType='artist_follow' AND targetId=artistId`).
   * Do not count the unfiltered global feed for an artist overview, and never
   * reconstruct financial totals from this sampled feed — use
   * `GET /api/artists/:id/stats` revenue instead.
   */
  static async getActivityFeed(req: Request, res: Response): Promise<void> {
    const feedRepo = AppDataSource.getRepository(ActivityFeed);
    const followRepo = AppDataSource.getRepository(UserFollow);
    const songRepo = AppDataSource.getRepository(Song);

    const mode = req.query.mode as string;
    const userId = (req as any).user?.id;
    const rawArtistId =
      (req.query.artistId as string | undefined) ??
      (req.query.artist as string | undefined) ??
      (req.query.artist_id as string | undefined) ??
      (req.query.userId as string | undefined) ??
      (req.query.user_id as string | undefined);
    const artistId = typeof rawArtistId === 'string' && rawArtistId.trim().length > 0 ? rawArtistId.trim() : undefined;
    const rawType = req.query.type as string | string[] | undefined;

    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const parseTypes = (value: string | string[] | undefined): string[] | undefined => {
      if (!value) return undefined;
      const list = Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      return list.length > 0 ? list : undefined;
    };

    // Artist-scoped overview feed: owned-song activity, not just authored rows.
    if (artistId) {
      const songs = await songRepo.find({ where: { artistId } as any, select: ['id'] });
      const songIds = songs.map((s: any) => s.id);
      const types = parseTypes(rawType);

      const qb = feedRepo.createQueryBuilder('activity');
      if (songIds.length > 0) {
        qb.where(
          '(activity.userId = :artistId OR activity.targetId IN (:...songIds) OR (activity.actionType = :followType AND activity.targetId = :artistId))',
          { artistId, songIds, followType: 'artist_follow' },
        );
      } else {
        // Artist with no songs: own actions + follows of the artist.
        qb.where(
          '(activity.userId = :artistId OR (activity.actionType = :followType AND activity.targetId = :artistId))',
          { artistId, followType: 'artist_follow' },
        );
      }
      if (types) {
        qb.andWhere('activity.actionType IN (:...types)', { types });
      }
      const [items, total] = await qb
        .orderBy('activity.createdAt', 'DESC')
        .skip(skip)
        .take(limit)
        .getManyAndCount();

      res.status(200).json({ page, limit, total, data: items });
      return;
    }

    if (mode === 'following') {
      if (!userId) {
        throw AppError.authentication('Authentication required for following feed');
      }

      const follows = await followRepo.find({
        where: { followerId: userId },
        select: ['followingId'],
      });

      const followingIds = follows.map((f: any) => f.followingId);

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
  }
}
