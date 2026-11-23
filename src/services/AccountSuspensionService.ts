import AppDataSource from '../config/db';
import { AccountSuspensionType, User, UserRole } from '../entities/User';
import { AppError } from '../errors/AppError';
import { CacheService } from './CacheService';

/**
 * How long an account's suspension state is cached on the request path (#980).
 * Suspend and reinstate invalidate the entry, so the TTL only bounds how stale a
 * lookup can be on an instance that did not perform the change.
 */
export const SUSPENSION_CACHE_TTL_MS = 30 * 1000;

/** Roles that only a super admin may restrict. */
const PRIVILEGED_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

export interface SuspensionActor {
  id: string;
  role?: UserRole;
}

export interface SuspensionInput {
  type: AccountSuspensionType;
  reason: string;
}

export interface SuspensionState {
  id: string;
  suspendedAt: Date | null;
  suspensionType: AccountSuspensionType | null;
}

function suspensionCacheKey(userId: string): string {
  return `account:suspension:${userId}`;
}

/**
 * Suspends, bans and reinstates accounts (#980). A restricted account is
 * refused on every authenticated request; see `authenticateRequest`.
 */
export class AccountSuspensionService {
  /**
   * True when the account is currently suspended or banned.
   *
   * Returns false when the data source is not initialised. The app does not
   * serve requests before its data source connects, so this only applies to
   * isolated middleware tests.
   */
  static async isSuspended(userId: string | undefined): Promise<boolean> {
    if (!userId || !AppDataSource.isInitialized) return false;

    const cached = await CacheService.get<{ suspended: boolean }>(suspensionCacheKey(userId));
    if (cached) return cached.suspended;

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      select: ['id', 'suspendedAt'],
    });
    const suspended = Boolean(user?.suspendedAt);
    await CacheService.set(suspensionCacheKey(userId), { suspended }, SUSPENSION_CACHE_TTL_MS);
    return suspended;
  }

  /**
   * Restrict an account. Admins cannot restrict themselves, and only a super
   * admin can restrict another admin or super admin.
   *
   * @throws {AppError} 400 on self-restriction, 404 when the user is missing,
   *   403 when the actor may not restrict the target's role.
   */
  static async suspend(
    actor: SuspensionActor,
    targetId: string,
    input: SuspensionInput,
  ): Promise<SuspensionState> {
    if (actor.id === targetId) {
      throw AppError.validation(
        'You cannot suspend your own account',
        undefined,
        'SELF_SUSPENSION',
      );
    }

    const repo = AppDataSource.getRepository(User);
    const target = await repo.findOne({ where: { id: targetId }, select: ['id', 'role'] });
    if (!target) {
      throw AppError.notFound('User not found', undefined, 'USER_NOT_FOUND');
    }
    if (PRIVILEGED_ROLES.includes(target.role) && actor.role !== UserRole.SUPER_ADMIN) {
      throw AppError.authorization(
        'Only a super admin can restrict an admin account',
        undefined,
        'SUSPENSION_FORBIDDEN',
      );
    }

    const suspendedAt = new Date();
    await repo.update(
      { id: targetId },
      {
        suspendedAt,
        suspendedBy: actor.id,
        suspensionType: input.type,
        suspensionReason: input.reason,
      },
    );
    await CacheService.invalidate(suspensionCacheKey(targetId));

    return { id: targetId, suspendedAt, suspensionType: input.type };
  }

  /**
   * Lift a suspension or ban. Reinstating an account that is already active is
   * a no-op.
   *
   * @throws {AppError} 404 when the user does not exist.
   */
  static async reinstate(targetId: string): Promise<void> {
    const result = await AppDataSource.getRepository(User).update(
      { id: targetId },
      { suspendedAt: null, suspendedBy: null, suspensionType: null, suspensionReason: null },
    );
    if (!result.affected) {
      throw AppError.notFound('User not found', undefined, 'USER_NOT_FOUND');
    }
    await CacheService.invalidate(suspensionCacheKey(targetId));
  }
}
