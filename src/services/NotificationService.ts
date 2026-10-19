import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Notification, NotificationType } from '../entities/Notification';
import { NotificationPreference } from '../entities/NotificationPreference';
import { AppError } from '../errors/AppError';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType | string;
  title: string;
  message: string;
  data?: Record<string, any> | null;
}

/**
 * Database-backed user notifications (Issue #79, #427).
 *
 * Notifications are created programmatically (e.g. by the royalty payout,
 * song processing, and marketplace flows) and read through the API.
 * Users can manage preferences per notification type.
 */
export class NotificationService {
  private notificationRepo: Repository<Notification>;
  private preferenceRepo: Repository<NotificationPreference>;

  constructor() {
    this.notificationRepo = AppDataSource.getRepository(Notification);
    this.preferenceRepo = AppDataSource.getRepository(NotificationPreference);
  }

  /**
   * Check if a specific notification type is enabled for a user (Issue #427).
   */
  async isTypeEnabled(userId: string, type: NotificationType | string): Promise<boolean> {
    const pref = await this.preferenceRepo.findOneBy({ userId, type });
    return pref ? pref.enabled : true;
  }

  /**
   * Create a notification for a user unless they have opted out of this type (Issue #427).
   * Returns null if the user has disabled this notification type.
   */
  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const enabled = await this.isTypeEnabled(input.userId, input.type);
    if (!enabled) {
      return null;
    }

    const notification = this.notificationRepo.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      data: input.data ?? null,
      isRead: false,
    });
    return this.notificationRepo.save(notification);
  }

  /**
   * Get all explicit notification preferences for a user (Issue #427).
   */
  async getPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.preferenceRepo.findBy({ userId });
  }

  /**
   * Set or update a notification preference for a user (Issue #427).
   */
  async setPreference(
    userId: string,
    type: NotificationType | string,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    let pref = await this.preferenceRepo.findOneBy({ userId, type });
    if (pref) {
      pref.enabled = enabled;
    } else {
      pref = this.preferenceRepo.create({ userId, type, enabled });
    }
    return this.preferenceRepo.save(pref);
  }

  /**
   * Batch update notification preferences for a user (Issue #427).
   */
  async updatePreferences(
    userId: string,
    preferences: Array<{ type: NotificationType | string; enabled: boolean }>,
  ): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];
    for (const item of preferences) {
      const updated = await this.setPreference(userId, item.type, item.enabled);
      results.push(updated);
    }
    return results;
  }

  /**
   * List a user's notifications, newest first, with an unread count.
   */
  async listForUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Notification[];
    unreadCount: number;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const [items, total] = await this.notificationRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const unreadCount = await this.notificationRepo.count({
      where: { userId, isRead: false },
    });

    return {
      data: items,
      unreadCount,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 0,
      },
    };
  }

  /**
   * Mark a single notification as read. Only the recipient may do so.
   */
  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.notificationRepo.findOneBy({ id: notificationId });
    if (!notification) {
      throw AppError.notFound('Notification not found', undefined, 'NOTIFICATION_NOT_FOUND');
    }
    if (notification.userId !== userId) {
      throw AppError.authorization(
        'You can only mark your own notifications as read',
        undefined,
        'NOT_NOTIFICATION_OWNER',
      );
    }

    if (!notification.isRead) {
      notification.isRead = true;
      return this.notificationRepo.save(notification);
    }
    return notification;
  }

  /**
   * Mark every notification of the user as read.
   *
   * @returns The number of notifications updated.
   */
  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepo.update({ userId, isRead: false }, { isRead: true });
    return { updated: result.affected ?? 0 };
  }
}
