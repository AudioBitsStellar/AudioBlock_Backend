import { Repository, In } from 'typeorm';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { UserFollow } from '../entities/UserFollow';
import { AppError } from '../errors/AppError';

export const KNOWN_ACTIVITY_TYPES = [
  'song_upload',
  'song_purchase',
  'artist_follow',
  'song_save',
  'album_release',
] as const;

export type ActivityType = (typeof KNOWN_ACTIVITY_TYPES)[number];

export class ActivityService {
  private activityRepo: Repository<ActivityFeed>;
  private userFollowRepo: Repository<UserFollow>;

  async recordActivity(
    userId: string,
    actionType: ActivityType,
    targetId: string,
    targetType: string,
    metadata?: any
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

  private validateTypes(types: string[]): void {
    for (const t of types) {
      if (!((KNOWN_ACTIVITY_TYPES as readonly string[]).includes(t))) {
        throw AppError.badRequest(`Invalid activity type: ${t}`);
      }
    }
  }

  async getFeed(userId: string, cursor?: string, limit = 20, typeFilter?: string | string[]) {
    // For now, we only query for the user's own activities as 'following' relation is not defined in User
    const userIds = [userId];
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let query = this.activityRepo.createQueryBuilder('activity')
      .where('activity.userId IN (:...userIds)', { userIds })
      .andWhere('activity.createdAt > :ninetyDaysAgo', { ninetyDaysAgo });

    if (typeFilter) {
      const types = Array.isArray(typeFilter) ? typeFilter : typeFilter.split(',').map(s => s.trim()).filter(Boolean);
      this.validateTypes(types);
      if (types.length > 0) {
        query = query.andWhere('activity.actionType IN (:...types)', { types });
      }
    }

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
    }

    const activities = await query
      .orderBy('activity.createdAt', 'DESC')
      .limit(limit)
      .getMany();

      const followingIds = follows.map((f) => f.followingId);

  async getUserActivities(userId: string, cursor?: string, limit = 20, typeFilter?: string | string[]) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const [items, total] = await this.activityRepo.findAndCount({
        where: { userId: In(followingIds) },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
        relations: ['user'],
      });

    if (typeFilter) {
      const types = Array.isArray(typeFilter) ? typeFilter : typeFilter.split(',').map(s => s.trim()).filter(Boolean);
      this.validateTypes(types);
      if (types.length > 0) {
        query = query.andWhere('activity.actionType IN (:...types)', { types });
      }
    }

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
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
