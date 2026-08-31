import { In, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { ActivityFeed } from '../entities/ActivityFeed';
import { User } from '../entities/User';
import { UserFollow } from '../entities/UserFollow';
import { IndexedEvent } from '../entities/IndexedEvent';
import { AppError } from '../errors/AppError';
import { IndexedEventService, InsertIndexedEventDTO } from './IndexedEventService';

export interface OnChainActivityFilters {
  contractType?: string;
  eventType?: string;
  address?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const VALID_ACTION_TYPES = [
  'song_upload',
  'song_purchase',
  'artist_follow',
  'song_save',
  'album_release',
];

export class ActivityService {
  private get activityRepo(): Repository<ActivityFeed> {
    return AppDataSource.getRepository(ActivityFeed);
  }

  private get userRepo(): Repository<User> {
    return AppDataSource.getRepository(User);
  }

  private get userFollowRepo(): Repository<UserFollow> {
    return AppDataSource.getRepository(UserFollow);
  }

  private get indexedEventRepo(): Repository<IndexedEvent> {
    return AppDataSource.getRepository(IndexedEvent);
  }

  /**
   * Query indexed on-chain activity events with filters and pagination.
   */
  async getOnChainActivity(
    filters: OnChainActivityFilters = {},
  ): Promise<PaginatedResult<IndexedEvent>> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(Math.max(1, filters.limit ?? 20), 100);

    const query = this.indexedEventRepo
      .createQueryBuilder('event')
      .orderBy('event.createdAt', 'DESC');

    if (filters.contractType) {
      query.andWhere('event.contractType = :contractType', {
        contractType: filters.contractType,
      });
    }

    if (filters.eventType) {
      query.andWhere('event.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (filters.address) {
      query.andWhere('event.address = :address', {
        address: filters.address,
      });
    }

    query.skip((page - 1) * limit).take(limit);

    const [data, total] = await query.getManyAndCount();

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  /**
   * Idempotently insert an indexed on-chain event.
   * Duplicate events are treated as a no-op and return the existing record.
   */
  async upsertIndexedEvent(dto: InsertIndexedEventDTO): Promise<IndexedEvent> {
    const indexedEventService = new IndexedEventService();
    return indexedEventService.upsertEvent(dto);
  }

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

  private parseAndValidateTypes(type?: string | string[]): string[] | undefined {
    if (!type) return undefined;
    const types = Array.isArray(type) ? type : type.split(',').map((t) => t.trim());

    for (const t of types) {
      if (!VALID_ACTION_TYPES.includes(t)) {
        throw AppError.validation(`Invalid activity type: ${t}`);
      }
    }
    return types;
  }

  async getFeed(userId: string, cursor?: string, limit = 20, type?: string | string[]) {
    const userIds = [userId];
    const types = this.parseAndValidateTypes(type);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let query = this.activityRepo
      .createQueryBuilder('activity')
      .where('activity.userId IN (:...userIds)', { userIds })
      .andWhere('activity.createdAt > :ninetyDaysAgo', { ninetyDaysAgo });

    if (types && types.length > 0) {
      query = query.andWhere('activity.actionType IN (:...types)', { types });
    }

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
    }

    const activities = await query.orderBy('activity.createdAt', 'DESC').limit(limit).getMany();

    return activities;
  }

  async getUserActivities(userId: string, cursor?: string, limit = 20, type?: string | string[]) {
    const types = this.parseAndValidateTypes(type);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let query = this.activityRepo
      .createQueryBuilder('activity')
      .where('activity.userId = :userId', { userId })
      .andWhere('activity.createdAt > :ninetyDaysAgo', { ninetyDaysAgo });

    if (types && types.length > 0) {
      query = query.andWhere('activity.actionType IN (:...types)', { types });
    }

    if (cursor) {
      query = query.andWhere('activity.id < :cursor', { cursor });
    }

    const activities = await query.orderBy('activity.createdAt', 'DESC').limit(limit).getMany();

    return activities;
  }

  async getActivityFeed(options: {
    userId?: string;
    mode?: 'all' | 'following';
    limit?: number;
    offset?: number;
  }): Promise<any>;
  async getActivityFeed(
    userId?: string,
    followingOnly?: boolean,
    limit?: number,
    offset?: number,
  ): Promise<{ items: any[]; total: number }>;
  async getActivityFeed(
    arg1?:
      string | { userId?: string; mode?: 'all' | 'following'; limit?: number; offset?: number },
    arg2?: boolean,
    limit = 20,
    offset = 0,
  ): Promise<any> {
    if (typeof arg1 === 'object' && arg1 !== null) {
      const { userId, mode = 'all', limit: optLimit = 20 } = arg1;
      if (mode === 'following') {
        if (!userId) {
          throw AppError.authentication('Authentication required for following feed');
        }
        const follows = await this.userFollowRepo.find({
          where: { followerId: userId },
          select: ['followingId'],
        });
        const followingIds = follows.map((f: any) => f.followingId);
        if (followingIds.length === 0) return [];
        return this.activityRepo.find({
          where: { userId: In(followingIds) },
          order: { createdAt: 'DESC' },
          take: optLimit,
        });
      }
      return this.activityRepo.find({
        order: { createdAt: 'DESC' },
        take: optLimit,
      });
    }

    const userId = arg1;
    const followingOnly = arg2;
    if (followingOnly) {
      if (!userId) {
        throw AppError.authentication('User ID required for following feed');
      }
      const follows = await this.userFollowRepo.find({
        where: { followerId: userId },
        select: ['followingId'],
      });
      const followingIds = follows.map((f: any) => f.followingId);
      if (followingIds.length === 0) {
        return { items: [], total: 0 };
      }
      const [items, total] = await this.activityRepo.findAndCount({
        where: { userId: In(followingIds) },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });
      return { items, total };
    }

    const [items, total] = await this.activityRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }
}
