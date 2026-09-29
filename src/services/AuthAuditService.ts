import { Repository } from 'typeorm';
import { Request } from 'express';
import AppDataSource from '../config/db';
import { AuthAuditLog, AuthEventType } from '../entities/AuthAuditLog';
import logger from '../config/logger';

export class AuthAuditService {
  private auditRepo: Repository<AuthAuditLog>;

  constructor() {
    this.auditRepo = AppDataSource.getRepository(AuthAuditLog);
  }

  /**
   * Log an authentication event with full context for security auditing.
   * Captures IP, user agent, and event-specific metadata.
   */
  asyn
mail: options.email,
        privyUserId: options.privyUserId,
        ipAddress,
        userAgent,
        success: options.success ?? true,
        failureReason: options.failureReason,
        metadata: options.metadata,
      });

      await this.auditRepo.save(auditLog);

      logger.info(
        {
          eventType,
          userId: options.userId,
          email: options.email,
          ipAddress,
          success: options.success ?? true,
        },
        'Auth event logged',
      );
    } catch (error) {
      // Never throw from audit logging - it should not break the main flow
      logger.error({ error, eventType }, 'Failed to log auth event');
    }
  }

  /**
   * Extract IP address from request, handling proxies and load balancers.
   */
  private extractIpAddress(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress;
  }

  /**
   * Query audit logs for a specific user.
   */
  async getUserAuditLogs(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ logs: AuthAuditLog[]; total: number }> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const [logs, total] = await this.auditRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { logs, total };
  }

  /**
   * Query recent failed login attempts for security monitoring.
   */
  async getRecentFailedLogins(
    email: string,
    sinceMinutes: number = 60,
  ): Promise<AuthAuditLog[]> {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

    return this.auditRepo
      .createQueryBuilder('log')
      .where('log.email = :email', { email })
      .andWhere('log.success = :success', { success: false })
      .andWhere('log.createdAt >= :since', { since })
      .andWhere('log.eventType IN (:...eventTypes)', {
        eventTypes: [
          AuthEventType.LOGIN_FAILED,
          AuthEventType.PRIVY_LOGIN_FAILED,
          AuthEventType.TOKEN_REFRESH_FAILED,
        ],
      })
      .orderBy('log.createdAt', 'DESC')
      .getMany();
  }
}
