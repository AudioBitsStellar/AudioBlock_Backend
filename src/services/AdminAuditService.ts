import AppDataSource from '../config/db';
import { AdminAuditLog } from '../entities/AdminAuditLog';
import { PaginatedResponse, paginatedResponse } from '../utils/pagination';

export type AdminAuditEntry = Omit<AdminAuditLog, 'id' | 'createdAt'>;

export interface AdminAuditListParams {
  page: number;
  limit: number;
  skip: number;
  actorId?: string;
}

/** Writes and reads the admin audit trail (#980). */
export class AdminAuditService {
  /** Persist one audit entry. Callers decide how to handle a failure. */
  static async record(entry: AdminAuditEntry): Promise<void> {
    await AppDataSource.getRepository(AdminAuditLog).insert(entry);
  }

  /** Most recent entries first, optionally narrowed to a single actor. */
  static async list(params: AdminAuditListParams): Promise<PaginatedResponse<AdminAuditLog>> {
    const [items, total] = await AppDataSource.getRepository(AdminAuditLog).findAndCount({
      where: params.actorId ? { actorId: params.actorId } : {},
      order: { createdAt: 'DESC' },
      skip: params.skip,
      take: params.limit,
    });
    return paginatedResponse(items, total, params.page, params.limit);
  }
}
