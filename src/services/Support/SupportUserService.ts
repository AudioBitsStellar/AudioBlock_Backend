import { FindOptionsSelect, FindOptionsWhere, Repository } from 'typeorm';
import AppDataSource from '../../config/db';
import { User, UserRole } from '../../entities/User';
import { AppError } from '../../errors/AppError';
import { TransactionLogService } from '../TransactionLogService';

/** Audit action written for every support lookup, whether or not it matches (#983). */
export const SUPPORT_USER_LOOKUP_ACTION = 'SUPPORT_USER_LOOKUP';

const MAX_QUERY_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Columns a support lookup reads from the database. This is an allowlist: the
 * password hash, 2FA secret, recovery codes, reset and verification tokens, and
 * Privy session material are never selected, so they cannot reach the response.
 */
const SUPPORT_SELECT: FindOptionsSelect<User> = {
  id: true,
  username: true,
  email: true,
  role: true,
  emailVerified: true,
  twoFactorEnabled: true,
  isVerified: true,
  walletAddress: true,
  stellarPublicKey: true,
  privyUserId: true,
  payoutHoldReason: true,
  payoutHoldPlacedAt: true,
  deletionRequestedAt: true,
  deletionScheduledFor: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

/** What a support agent sees for one account. Read-only, and every lookup is audited. */
export interface SupportUserView {
  id: string;
  username: string | null;
  email: string | null;
  role: UserRole;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  isVerified: boolean;
  walletAddress: string | null;
  stellarPublicKey: string | null;
  /** Whether a Privy identity is linked. The Privy id itself is not returned. */
  privyLinked: boolean;
  payoutHold: {
    active: boolean;
    reason: string | null;
    placedAt: Date | null;
  };
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  /** Non-null for an erased (tombstoned) account. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only user lookup for support and operations staff (#983).
 *
 * Impersonation is not implemented yet. It needs its own consent and session
 * design, and it is tracked as a follow-up. This service only reads.
 */
export class SupportUserService {
  private userRepo: Repository<User>;
  private transactionLog: TransactionLogService;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.transactionLog = new TransactionLogService();
  }

  /**
   * Finds one account by an exact identifier: id, email, username, wallet address,
   * Stellar public key, or Privy user id. Partial and fuzzy matching are not
   * supported, so the endpoint cannot be used to enumerate accounts.
   *
   * The audit entry is written before the result is returned. If the audit write
   * fails, the lookup fails and no data is released.
   *
   * @param query - The exact identifier to look up.
   * @param actorId - The support or admin user performing the lookup.
   * @returns The support view, or null when no account matches.
   * @throws AppError validation error when the query is empty or too long.
   */
  async lookupUser(query: string, actorId: string): Promise<SupportUserView | null> {
    const term = (query ?? '').trim();
    if (term.length === 0 || term.length > MAX_QUERY_LENGTH) {
      throw AppError.validation(`query must be 1-${MAX_QUERY_LENGTH} characters`, {
        field: 'query',
      });
    }

    const user = await this.userRepo.findOne({
      where: exactMatchClauses(term),
      select: SUPPORT_SELECT,
    });

    // The query text is not stored in the audit entry. It can hold an email address.
    await this.transactionLog.createLogEntry(
      actorId,
      '',
      SUPPORT_USER_LOOKUP_ACTION,
      `target=${user?.id ?? 'none'}`,
    );

    return user ? toSupportView(user) : null;
  }
}

/** Builds one exact-match clause per identifier. An `id` clause is added only for UUID input. */
function exactMatchClauses(term: string): FindOptionsWhere<User>[] {
  const clauses: FindOptionsWhere<User>[] = [
    { email: term },
    { username: term },
    { walletAddress: term },
    { stellarPublicKey: term },
    { privyUserId: term },
  ];

  // Postgres rejects a non-UUID value for a uuid column, so the id clause is
  // added only when the input has the UUID shape.
  if (UUID_PATTERN.test(term)) {
    clauses.push({ id: term });
  }

  return clauses;
}

function toSupportView(user: User): SupportUserView {
  return {
    id: user.id,
    username: user.username ?? null,
    email: user.email ?? null,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    isVerified: user.isVerified,
    walletAddress: user.walletAddress ?? null,
    stellarPublicKey: user.stellarPublicKey ?? null,
    privyLinked: Boolean(user.privyUserId),
    payoutHold: {
      active: Boolean(user.payoutHoldReason),
      reason: user.payoutHoldReason ?? null,
      placedAt: user.payoutHoldPlacedAt ?? null,
    },
    deletionRequestedAt: user.deletionRequestedAt ?? null,
    deletionScheduledFor: user.deletionScheduledFor ?? null,
    deletedAt: user.deletedAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
