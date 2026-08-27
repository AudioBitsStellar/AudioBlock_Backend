import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Notification, NotificationType } from '../entities/Notification';
import { AppError } from '../errors/AppError';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType | string;
  title: string;
  message: string;
  data?: Record<string, any> | null;
}

/**
 * Database-backed user notifications (Issue #79).
 *
 * Notifications are created programmatically (e.g. by the royalty payout,
 * song processing, and marketplace flows) and read through the API.
 */
export class NotificationService {
  private notificationRepo: Repository<Notification>;

  constructor() {
    this.notificationRepo = AppDataSource.getRepository(Notification);
  }

  /**
   * Create a notification for a user.
   */
  async create(input: CreateNotificationInput): Promise<Notification> {
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
