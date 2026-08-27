import { Repository, In } from 'typeorm';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { UserFollow } from '../entities/UserFollow';
import { AppError } from '../errors/AppError';

export class ActivityService {
  private activityRepo: Repository<ActivityFeed>;
  private userFollowRepo: Repository<UserFollow>;

  constructor() {
    this.activityRepo = AppDataSource.getRepository(ActivityFeed);
    this.userFollowRepo = AppDataSource.getRepository(UserFollow);
  }

  /**
   * Retrieve activity feed items. Supports an optional 'followingOnly' mode
   * which scopes results to accounts followed by the specified user.
   */
  async getActivityFeed(userId?: string, followingOnly?: boolean, limit: number = 20, offset: number = 0): Promise<{ items: ActivityFeed[]; total: number }> {
    if (followingOnly) {
      if (!userId) {
        throw AppError.authentication('Authentication required for following-only activity feed');
      }

      // Retrieve IDs of users that the current user follows
      const follows = await this.userFollowRepo.find({
        where: { followerId: userId },
        select: ['followingId'],
      });

      const followingIds = follows.map((f) => f.followingId);

      if (followingIds.length === 0) {
        return { items: [], total: 0 };
      }

      const [items, total] = await this.activityRepo.findAndCount({
        where: { userId: In(followingIds) },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
        relations: ['user'],
      });

      return { items, total };
    }

    const [items, total] = await this.activityRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: ['user'],
    });

    return { items, total };
  }
}
