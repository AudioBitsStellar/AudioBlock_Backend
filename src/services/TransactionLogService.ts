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
    const query = this.transactionLogRepo.createQueryBuilder('log')
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
    const mappedData = data.map(log => ({
      id: log.id,
      userId: log.user_id,
      xdrHash: log.txHash,
      status: log.action,
      errorMessage: log.description,
      createdAt: log.createdAt,
    }));

    return { data: mappedData, total };
  }
}
