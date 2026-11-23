import { createHmac } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';
import { Request } from 'express';
import AppDataSource from '../config/db';
import { AuthAuditLog, AuthEventType } from '../entities/AuthAuditLog';
import logger from '../config/logger';

/**
 * Default retention window. Override with AUDIT_LOG_RETENTION_DAYS env var.
 * Security best-practice minimum: 90 days. Regulatory environments (SOC 2,
 * PCI-DSS) typically require 365 days.
 */
const DEFAULT_RETENTION_DAYS = 365;

export class AuthAuditService {
  private auditRepo: Repository<AuthAuditLog>;

  constructor() {
    this.auditRepo = AppDataSource.getRepository(AuthAuditLog);
  }

  /**
   * Log an authentication event with full context for security auditing.
   * Captures IP, user agent, and event-specific metadata.
   */
  /**
   * HMAC-SHA256 of the record's immutable fields chained with previousHash.
   * The secret key comes from AUDIT_HMAC_SECRET; falls back to a fixed dev
   * constant so tests work without env config.
   */
  private computeHash(
    fields: Pick<AuthAuditLog, 'eventType' | 'userId' | 'email' | 'ipAddress' | 'success'> & {
      createdAt: Date;
    },
    previousHash: string | null,
  ): string {
    const secret = process.env.AUDIT_HMAC_SECRET ?? 'audioblock-audit-dev-secret';
    const payload = [
      fields.eventType,
      fields.userId ?? '',
      fields.email ?? '',
      fields.ipAddress ?? '',
      fields.success ? '1' : '0',
      fields.createdAt.toISOString(),
      previousHash ?? '',
    ].join('|');
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  async logAuthEvent(
    eventType: AuthEventType,
    req: Request,
    options: {
      userId?: string;
      email?: string;
      privyUserId?: string;
      success?: boolean;
      failureReason?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    try {
      const ipAddress = this.extractIpAddress(req);
      const userAgent = req.headers['user-agent'];
      const success = options.success ?? true;

      // Fetch the most recent entry's hash to anchor the chain.
      const last = await this.auditRepo.findOne({
        where: {},
        order: { createdAt: 'DESC' },
        select: ['hash'],
      });
      const previousHash = last?.hash ?? null;

      const now = new Date();
      const auditLog = this.auditRepo.create({
        eventType,
        userId: options.userId,
        email: options.email,
        privyUserId: options.privyUserId,
        ipAddress,
        userAgent,
        success,
        failureReason: options.failureReason,
        metadata: options.metadata,
        previousHash: previousHash ?? undefined,
        createdAt: now,
      });

      auditLog.hash = this.computeHash(
        { eventType, userId: options.userId, email: options.email, ipAddress, success, createdAt: now },
        previousHash,
      );

      await this.auditRepo.save(auditLog);

      logger.info(
        {
          eventType,
          userId: options.userId,
          email: options.email,
          ipAddress,
          success,
        },
        'Auth event logged',
      );
    } catch (error) {
      // Never throw from audit logging - it should not break the main flow
      logger.error({ error, eventType }, 'Failed to log auth event');
    }
  }

  /**
   * Delete audit log entries older than `retentionDays` days.
   * Returns the number of rows deleted.
   */
  async purgeOldLogs(retentionDays?: number): Promise<number> {
    const days =
      retentionDays ??
      parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS), 10);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.auditRepo.delete({ createdAt: LessThan(cutoff) });
    const deleted = result.affected ?? 0;
    logger.info({ days, cutoff, deleted }, 'Audit log purge completed');
    return deleted;
  }

  /**
   * Walk every audit log row in chronological order and verify that each
   * entry's stored hash matches a fresh recomputation. Returns `{ valid: true }`
   * when the chain is intact, or `{ valid: false, brokenAt: <id> }` at the
   * first entry where the hash does not match.
   */
  async verifyChainIntegrity(): Promise<{ valid: boolean; brokenAt?: string }> {
    const rows = await this.auditRepo.find({ order: { createdAt: 'ASC' } });
    let previousHash: string | null = null;

    for (const row of rows) {
      const expected = this.computeHash(
        {
          eventType: row.eventType,
          userId: row.userId,
          email: row.email,
          ipAddress: row.ipAddress,
          success: row.success,
          createdAt: row.createdAt,
        },
        previousHash,
      );

      if (row.hash !== expected || (row.previousHash ?? null) !== previousHash) {
        return { valid: false, brokenAt: row.id };
      }

      previousHash = row.hash ?? null;
    }

    return { valid: true };
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
  async getRecentFailedLogins(email: string, sinceMinutes: number = 60): Promise<AuthAuditLog[]> {
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
