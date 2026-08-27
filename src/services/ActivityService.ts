import { Repository, In } from 'typeorm';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { UserFollow } from '../entities/UserFollow';
import { AppError } from '../errors/AppError';

export interface GetActivityFeedOptions {
  userId: string;
  mode?: 'all' | 'following';
  limit?: number;
  offset?: number;
}

export class ActivityService {
  private activityRepo: Repository<ActivityFeed>;
  private userFollowRepo: Repository<UserFollow>;

  constructor() {
    this.activityRepo = AppDataSource.getRepository(ActivityFeed);
    this.userFollowRepo = AppDataSource.getRepository(UserFollow);
  }

  async getActivityFeed(options: GetActivityFeedOptions): Promise<ActivityFeed[]> {
    const { userId, mode = 'all', limit = 20, offset = 0 } = options;

    if (mode === 'following') {
      // Find all users that the given user follows
      const follows = await this.userFollowRepo.find({
        where: { followerId: userId },
        select: ['followingId'],
      });

      const followingIds = follows.map((f) => f.followingId);

      if (followingIds.length === 0) {
        return [];
      }

      return await this.activityRepo.find({
        where: { userId: In(followingIds) },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });
    }

    // Default mode: platform-wide or user specific
    return await this.activityRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
