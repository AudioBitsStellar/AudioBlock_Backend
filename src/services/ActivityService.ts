import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { User } from '../entities/User';

export class ActivityService {
  private activityRepo = AppDataSource.getRepository(ActivityFeed);
  private userRepo = AppDataSource.getRepository(User);

  async recordActivity(
    userId: string,
    actionType: 'song_upload' | 'song_purchase' | 'artist_follow' | 'song_save' | 'album_release',
    targetId: string,
    targetType: string,
    metadata?: any,
  ): Promise<void> {
    try {
      const activity = this.activityRepo.create({
        userId,
        actionType,
        targetId,
        targetType,
        metadata,
      });
      await this.activityRepo.save(activity);
    } catch (error) {
      console.error('Failed to record activity', error);
    }
  }

  async getFeed(userId: string, cursor?: string, limit = 20) {
    // For now, we only query for the user's own activities as 'following' relation is not defined in User
    const userIds = [userId];

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let query = this.activityRepo
      .createQueryBuilder('activity')
      .where('activity.userId IN (:...userIds)', { userIds })
      .andWhere('activity.createdAt > :ninetyDaysAgo', { ninetyDaysAgo });

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
    }

    const activities = await query.orderBy('activity.createdAt', 'DESC').limit(limit).getMany();

    return activities;
  }

  async getUserActivities(userId: string, cursor?: string, limit = 20) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let query = this.activityRepo
      .createQueryBuilder('activity')
      .where('activity.userId = :userId', { userId })
      .andWhere('activity.createdAt > :ninetyDaysAgo', { ninetyDaysAgo });

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
    }

    const activities = await query.orderBy('activity.createdAt', 'DESC').limit(limit).getMany();

    return activities;
  }
}
