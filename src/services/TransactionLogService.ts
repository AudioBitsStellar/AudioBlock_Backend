import { Repository } from 'typeorm';
import { TransactionLog } from '../entities/TransactionLog';
import AppDataSource from '../config/db';

/**
 * Service for recording and querying audit trail entries (transaction logs).
 */
export class TransactionLogService {
  // Implement transaction log methods here
  private transactionLogRepo: Repository<TransactionLog>;
  constructor() {
    // Initialization code here
    this.transactionLogRepo = AppDataSource.getRepository(TransactionLog);
  }

  /**
   * Create a new audit log entry.
   *
   * @param userId - ID of the user who performed the action.
   * @param txHash - Associated transaction hash (may be empty for non-chain actions).
   * @param action - Action type identifier (e.g. "CREATE_USER", "SONG_PROCESSED").
   * @param description - Human-readable description of the action.
   * @returns The persisted TransactionLog entity.
   */
  async createLogEntry(
    userId: string,
    txHash: string,
    action: string,
    description: string,
  ): Promise<TransactionLog> {
    const log = this.transactionLogRepo.create({
      user_id: userId,
      txHash,
      action,
      description,
    });
    await this.transactionLogRepo.save(log);
    return log;
  }

  /**
   * Retrieve all audit log entries for a given user.
   *
   * @param userId - The user's UUID.
   * @returns Array of TransactionLog entities for that user.
   */
  async getLogsByUser(userId: string): Promise<any[]> {
    return this.transactionLogRepo.findBy({ user_id: userId });
  }

  /**
   * Retrieve transaction logs with filters and pagination for admins (Issue #39).
   */
  async getAdminLogs(filters: {
    userId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number }> {
    const query = this.transactionLogRepo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC');

    if (filters.userId) {
      query.andWhere('log.user_id = :userId', { userId: filters.userId });
    }
    if (filters.status) {
      query.andWhere('log.action = :status', { status: filters.status });
    }
    if (filters.startDate) {
      query.andWhere('log.createdAt >= :startDate', { startDate: filters.startDate });
    }
    if (filters.endDate) {
      query.andWhere('log.createdAt <= :endDate', { endDate: filters.endDate });
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    query.skip((page - 1) * limit).take(limit);

    const [data, total] = await query.getManyAndCount();

    // The response must include xdr hash (txHash), status (action), error message (description)
    const mappedData = data.map((log) => ({
      id: log.id,
      userId: log.user_id,
      xdrHash: log.txHash,
      status: log.action,
      errorMessage: log.description,
      createdAt: log.createdAt,
    }));

    return { data: mappedData, total };
  }

  /**
   * Get wallet balance history for a user with filtering and pagination (Issue #84).
   *
   * @param userId - The user's UUID.
   * @param filters - Optional type and date range filters.
   * @param page - 1-based page number.
   * @param limit - Results per page (max 100).
   * @returns Paginated transactions with amount, type, description, and running balance.
   */
  async getWalletHistory(
    userId: string,
    filters: {
      type?: string;
      from?: string;
      to?: string;
    } = {},
    page = 1,
    limit = 20,
  ): Promise<{
    entries: Array<{
      id: string;
      amount: number | null;
      type: string;
      description: string | null;
      timestamp: Date;
      relatedEntityId: string | null;
      relatedEntityType: string | null;
      txHash: string;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    runningBalance: number;
  }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const qb = this.transactionLogRepo
      .createQueryBuilder('log')
      .where('log.user_id = :userId', { userId })
      .orderBy('log.createdAt', 'DESC');

    if (filters.type) {
      qb.andWhere('log.action = :type', { type: filters.type });
    }

    if (filters.from) {
      qb.andWhere('log.createdAt >= :from', { from: filters.from });
    }

    if (filters.to) {
      qb.andWhere('log.createdAt <= :to', { to: filters.to });
    }

    qb.skip((safePage - 1) * safeLimit).take(safeLimit);

    const [logs, total] = await qb.getManyAndCount();

    // Calculate running balance: sum all amounts across all time
    const balanceQb = this.transactionLogRepo
      .createQueryBuilder('log')
      .select('COALESCE(SUM(log.amount), 0)', 'balance')
      .where('log.user_id = :userId', { userId });

    if (filters.type) {
      balanceQb.andWhere('log.action = :type', { type: filters.type });
    }
    if (filters.from) {
      balanceQb.andWhere('log.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      balanceQb.andWhere('log.createdAt <= :to', { to: filters.to });
    }

    const balanceResult = await balanceQb.getRawOne();
    const runningBalance = parseFloat(balanceResult?.balance ?? '0');

    const entries = logs.map((log) => ({
      id: log.id,
      amount: log.amount ?? null,
      type: log.action,
      description: log.description ?? null,
      timestamp: log.createdAt,
      relatedEntityId: log.relatedEntityId ?? null,
      relatedEntityType: log.relatedEntityType ?? null,
      txHash: log.txHash,
    }));

    return {
      entries,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 0,
      runningBalance,
    };
  }
}
