import { DataSource, In } from 'typeorm';
import { randomUUID } from 'crypto';
import AppDataSource from '../config/db';
import logger from '../config/logger';
import { AppError } from '../errors/AppError';
import { CacheService } from './CacheService';
import { User, UserRole } from '../entities/User';
import {
  AccountDeletionRequest,
  type AccountDeletionStatus,
} from '../entities/AccountDeletionRequest';
import { deleteLinkedPrivyIdentity } from './privy/PrivyIdentityService';

/** Default grace window between a deletion request and the erasure running (30 days). */
const DEFAULT_GRACE_PERIOD_DAYS = 30;

/**
 * Tables whose rows are the user's *own* personal data with no residual value to
 * anyone else once the account goes. Deleted outright.
 *
 * The rule applied is Art. 17(1) erasure for data whose only purpose was to serve
 * that person. Credentials (`api_keys`) are the sharpest case — leaving a live
 * API key behind after "delete my account" would be a security defect, not just
 * a privacy one.
 */
const PURGE_TABLES: ReadonlyArray<{ table: string; columns: readonly string[] }> = [
  { table: 'refresh_tokens', columns: ['userId'] },
  { table: 'api_keys', columns: ['userId'] },
  { table: 'webhook_subscriptions', columns: ['userId'] },
  { table: 'notifications', columns: ['userId'] },
  { table: 'song_saves', columns: ['userId'] },
  { table: 'user_saves', columns: ['userId'] },
  { table: 'user_follows', columns: ['followerId'] },
  { table: 'user_follows', columns: ['followingId'] },
  { table: 'playlist_follows', columns: ['userId'] },
  { table: 'playlist_collaborators', columns: ['userId'] },
  { table: 'ai_generation_records', columns: ['userId'] },
  { table: 'tweet_drafts', columns: ['userId'] },
  { table: 'activity_feeds', columns: ['userId'] },
  { table: 'fan_perks', columns: ['artistId'] },
  { table: 'subscriptions', columns: ['userId'] },
  { table: 'gift_subscriptions', columns: ['senderId'] },
  { table: 'gift_subscriptions', columns: ['recipientId'] },
  { table: 'song_play_events', columns: ['listenerId'] },
  { table: 'song_collaborators', columns: ['userId'] },
  { table: 'artist_verifications', columns: ['userId'] },
];

/**
 * Tables deliberately NOT purged, with the reasoning (Art. 17(3)).
 *
 * - `songs` / `albums` / `releases` — these are minted as NFTs that exist on-chain
 *   and are held by third parties. Deleting the database row would orphan a
 *   real, transferable asset and break every existing holder's client. Their
 *   *attribution* is removed by anonymising the user row, so the content stays
 *   but the person behind it is not identifiable.
 * - `comments` — same reasoning: other users hold the thread, and removing a
 *   message mid-conversation is more harmful than making it unattributable.
 * - `royalty_payouts` — financial records we are legally obliged to retain
 *   (Art. 17(3)(b) legal obligation, (e) contract performance). `royalty_payouts`
 *   already has `ON DELETE SET NULL` on the artist FK for this reason.
 * - `transaction_logs` — the audit trail of what happened to the account.
 * - `playlists` — same category as comments; retained but unattributable.
 */
const RETAINED_TABLES_NOTE =
  'songs, albums, releases, comments, playlists, royalty_payouts and transaction_logs are ' +
  'retained but become unattributable once the user row is anonymised (Art. 17(3)(b)/(e))';

/** User columns scrubbed during anonymisation. */
const ANONYMISED_FIELDS = [
  'email',
  'username',
  'name',
  'bio',
  'profileImage',
  'avatarIpfsHash',
  'pageCover',
  'website',
  'walletAddress',
  'stellarPublicKey',
  'stellarArtistId',
  'stellarArtistTokenId',
  'passwordHash',
  'twoFactorSecret',
  'twoFactorRecoveryCodeHashes',
  'emailVerificationToken',
  'emailVerificationTokenExpiry',
  'passwordResetToken',
  'passwordResetTokenExpiry',
  'twitterId',
  'twitterUsername',
  'twitterDisplayName',
  'twitterProfileImage',
  'twitterConnected',
  'facebookId',
  'facebookName',
  'facebookEmail',
  'facebookProfileImage',
  'facebookConnected',
  'dynamixUserId',
  'privyUserId',
] as const;

export interface DeletionRequestResult {
  /** Opaque id the user can quote to support. */
  referenceId: string;
  requestedAt: Date;
  /** When erasure will run unless the request is cancelled. */
  scheduledFor: Date;
  gracePeriodDays: number;
}

export interface DeletionStatus {
  requested: boolean;
  cancelled: boolean;
  completed: boolean;
  requestedAt?: Date;
  scheduledFor?: Date;
  completedAt?: Date;
  referenceId?: string;
}

export interface PurgeResult {
  userId: string;
  /** Rows removed per table, for the audit record. */
  deleted: Record<string, number>;
  /** Cache/Redis keys invalidated. */
  cacheKeysInvalidated: number;
  /** Whether the linked Privy identity was removed upstream. */
  privyDeletion: 'succeeded' | 'failed' | 'skipped';
  /** Non-fatal problems worth recording in the audit trail. */
  warnings: string[];
}

/** Read the configured grace window, defaulting to 30 days. */
function gracePeriodDays(): number {
  const parsed = Number.parseInt(process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRACE_PERIOD_DAYS;
}

/**
 * GDPR account deletion and data portability (Issue #633).
 *
 * Deletion is a two-phase flow rather than an immediate `DELETE FROM users`.
 *
 * **Why not delete the row outright.** `users` is the parent of the platform's
 * financial and on-chain records. `royalty_payouts.artist_id` is deliberately
 * `ON DELETE SET NULL` and the artist's songs are minted as on-chain NFTs owned
 * by third parties — so dropping the user row would destroy the audit trail for
 * money already paid out and orphan assets that still exist. GDPR anticipates
 * exactly this: Art. 17(3)(b) and 17(3)(e) exempt data that must be retained for
 * a legal obligation or for contract performance.
 *
 * **What the flow does instead.** The user row is kept as a *tombstone*: every
 * identifying field is nulled and `deletedAt` is set, which both erases the
 * personal data (Art. 17(1)) and leaves retained records permanently
 * unattributable. Everything that is purely the user's own — sessions, API keys,
 * saves, follows, notifications, listening history — is deleted outright.
 *
 * **Why a grace window.** Art. 12(3) requires confirmation, and the
 * irreversible step should not be a single click on a shared device. The user has
 * a configurable window (30 days by default) to export their data (Art. 15/20) or
 * cancel, after which a background job performs the erasure.
 */
export class AccountDeletionService {
  private readonly dataSource: DataSource;
  private readonly purgeTables: ReadonlyArray<{ table: string; columns: readonly string[] }>;

  constructor(dataSource: DataSource = AppDataSource) {
    this.dataSource = dataSource;
    this.purgeTables = PURGE_TABLES;
  }

  private get userRepo() {
    return this.dataSource.getRepository(User);
  }

  private get requestRepo() {
    return this.dataSource.getRepository(AccountDeletionRequest);
  }

  /**
   * Start account deletion: mark the user, schedule the erasure, and revoke
   * every active session immediately.
   *
   * Sessions are revoked now rather than at the end of the grace window: the user
   * has said they want to leave, and leaving live refresh tokens for 30 days
   * would mean a leaked token stays useful long after the request.
   *
   * Idempotent — a second call returns the existing request rather than
   * resetting the clock, so a user cannot accidentally extend their own deadline.
   */
  async requestDeletion(userId: string, reason?: string): Promise<DeletionRequestResult> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.deletedAt) {
      throw AppError.businessLogic('Account has already been deleted');
    }

    const existing = await this.requestRepo.findOne({
      where: { userId, status: 'requested' },
      order: { requestedAt: 'DESC' },
    });
    if (existing) {
      return {
        referenceId: existing.referenceId,
        requestedAt: existing.requestedAt,
        scheduledFor: existing.gracePeriodEndsAt,
        gracePeriodDays: gracePeriodDays(),
      };
    }

    const days = gracePeriodDays();
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const referenceId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: userId }, {
        deletionRequestedAt: now,
        deletionScheduledFor: scheduledFor,
        deletionReason: reason ?? null,
      } as Partial<User>);

      await manager.getRepository(AccountDeletionRequest).insert({
        userId,
        status: 'requested' as AccountDeletionStatus,
        referenceId,
        requestedAt: now,
        gracePeriodEndsAt: scheduledFor,
        dataExported: false,
      });

      // Kill live sessions now. `revoked` is a soft flag so the family-detection
      // logic in AuthService still works, but the token can no longer be used.
      await manager.getRepository('refresh_tokens').update({ userId }, { revoked: true });
    });

    logger.info(
      { userId, referenceId, scheduledFor: scheduledFor.toISOString() },
      'Account deletion requested',
    );

    return { referenceId, requestedAt: now, scheduledFor, gracePeriodDays: days };
  }

  /**
   * Cancel a pending deletion request, restoring normal account access.
   *
   * Only valid inside the grace window. After erasure has run there is nothing
   * to cancel — the account no longer exists as far as its holder is concerned.
   */
  async cancelDeletion(userId: string): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.deletedAt) {
      throw AppError.businessLogic('Account has already been deleted and cannot be restored');
    }

    if (!user.deletionRequestedAt) {
      throw AppError.businessLogic('No pending deletion request to cancel');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: userId }, {
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        deletionReason: null,
      } as Partial<User>);
      await manager
        .getRepository(AccountDeletionRequest)
        .update({ userId, status: 'requested' }, { status: 'cancelled' as AccountDeletionStatus });
    });

    logger.info({ userId }, 'Account deletion request cancelled');
  }

  /** Current state of this account's deletion request, or `requested: false`. */
  async getStatus(userId: string): Promise<DeletionStatus> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.deletedAt) {
      return { requested: true, cancelled: false, completed: true, completedAt: user.deletedAt };
    }

    if (!user.deletionRequestedAt) {
      return { requested: false, cancelled: false, completed: false };
    }

    const request = await this.requestRepo.findOne({
      where: { userId, status: In(['requested', 'cancelled', 'completed']) },
      order: { requestedAt: 'DESC' },
    });

    return {
      requested: true,
      cancelled: false,
      completed: false,
      requestedAt: user.deletionRequestedAt,
      scheduledFor: user.deletionScheduledFor,
      referenceId: request?.referenceId,
    };
  }

  /**
   * Portability export of everything held about the user (Art. 15 and 20).
   *
   * Returns a structured object rather than a file so the caller chooses the
   * delivery format; the controller serialises it to JSON. Marks the audit row so
   * we can show the user exercised their Art. 20 right before deletion.
   *
   * @throws {AppError} 404 if the user does not exist, 403 if they are not a
   *   plain account holder. Admins are refused because an admin calling this
   *   would be pulling another user's data, and that belongs in the audited
   *   admin path, not the self-service one.
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.deletedAt) {
      throw AppError.businessLogic('Account has been deleted; no personal data remains');
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      throw AppError.authorization('Administrators must use the audited admin data-access path');
    }

    const [
      songs,
      albums,
      releases,
      comments,
      playlists,
      follows,
      followers,
      saves,
      playEvents,
      payouts,
      transactions,
    ] = await Promise.all([
      this.selectRows('songs', 'artistId', userId),
      this.selectRows('albums', 'artistId', userId),
      this.selectRows('releases', 'artistId', userId),
      this.selectRows('comments', 'userId', userId),
      this.selectRows('playlists', 'userId', userId),
      this.selectRows('user_follows', 'followerId', userId),
      this.selectRows('user_follows', 'followingId', userId),
      this.selectRows('user_saves', 'userId', userId),
      this.selectRows('song_play_events', 'listenerId', userId),
      this.selectRows('royalty_payouts', 'artist_id', userId),
      this.selectRows('transaction_logs', 'user_id', userId),
    ]);

    await this.requestRepo.update({ userId }, { dataExported: true });

    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email ?? null,
        username: user.username ?? null,
        name: user.name ?? null,
        role: user.role,
        bio: user.bio ?? null,
        profileImage: user.profileImage ?? null,
        website: user.website ?? null,
        walletAddress: user.walletAddress ?? null,
        stellarPublicKey: user.stellarPublicKey ?? null,
        twitterUsername: user.twitterUsername ?? null,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      content: { songs, albums, releases, comments, playlists },
      social: { following: follows, followers },
      activity: { saves, playEvents },
      financial: { royaltyPayouts: payouts, transactionLogs: transactions },
      note:
        'Aggregated play counts and AI training data are retained in anonymised, ' +
        'non-reversible form and are excluded from this export (Art. 17(3)(b)). ' +
        `Records outside this file (${RETAINED_TABLES_NOTE}) remain but are no longer attributable to you.`,
    };
  }

  /** Read rows from a table, tolerating a table that does not exist in this deployment. */
  private async selectRows(table: string, column: string, userId: string): Promise<unknown[]> {
    try {
      return await this.dataSource.query(`SELECT * FROM "${table}" WHERE "${column}" = $1`, [
        userId,
      ]);
    } catch (error) {
      // A deployment that predates a given feature may not have the table. That
      // is not a reason to fail a data-subject request; record and move on.
      logger.warn(
        { err: error, table },
        `Skipping "${table}" during data export (table unavailable)`,
      );
      return [];
    }
  }

  /**
   * Run the erasure for one account: purge personal data, anonymise the user row,
   * drop caches, and best-effort delete the linked Privy identity.
   *
   * @param userId - Account to erase.
   * @param force - Skip the grace-period check. For operator use (an erasure
   *   deadline being missed, or a legal order) and for tests only.
   * @throws {AppError} If the user does not exist, or has not requested deletion
   *   and `force` was not set.
   */
  async purgeUser(userId: string, options: { force?: boolean } = {}): Promise<PurgeResult> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.deletedAt) {
      // Idempotent: the job may retry a partially-completed erasure.
      return {
        userId,
        deleted: {},
        cacheKeysInvalidated: 0,
        privyDeletion: 'skipped',
        warnings: ['Account was already deleted; purge is a no-op'],
      };
    }

    if (!user.deletionRequestedAt && !options.force) {
      throw AppError.businessLogic('No pending deletion request for this account');
    }

    if (
      !options.force &&
      user.deletionScheduledFor &&
      user.deletionScheduledFor.getTime() > Date.now()
    ) {
      throw AppError.businessLogic(
        `Deletion is scheduled for ${user.deletionScheduledFor.toISOString()}; the grace period has not elapsed`,
      );
    }

    const warnings: string[] = [];
    const deleted: Record<string, number> = {};

    await this.dataSource.transaction(async (manager) => {
      for (const { table, columns } of this.purgeTables) {
        for (const column of columns) {
          try {
            const result = await manager.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [
              userId,
            ]);
            const key = `${table}.${column}`;
            deleted[key] = (deleted[key] ?? 0) + (Array.isArray(result) ? result.length : 0);
          } catch (error) {
            // Keep going. One unavailable table must not strand the rest of the
            // erasure, but it must be visible in the audit record.
            warnings.push(`Could not purge ${table}.${column}: ${(error as Error).message}`);
            logger.error(
              { err: error, table, column, userId },
              'Failed to purge table during erasure',
            );
          }
        }
      }

      // Anonymise rather than delete. See the class comment for why.
      const assignments = ANONYMISED_FIELDS.map(
        (field, index) => `"${field}" = $${index + 2}`,
      ).join(', ');
      const params: unknown[] = [
        new Date(),
        user.role,
        false,
        ...ANONYMISED_FIELDS.map(() => null),
      ];

      await manager.query(
        `UPDATE "users" SET "deletedAt" = $1, "role" = $2, "isProfilePublic" = $3, ${assignments} WHERE "id" = $${params.length + 1}`,
        [...params, userId],
      );

      await manager
        .getRepository(AccountDeletionRequest)
        .update(
          { userId, status: 'requested' },
          { status: 'completed' as AccountDeletionStatus, processedAt: new Date() },
        );
    });

    const cacheKeysInvalidated = await this.invalidateCaches(user, warnings);

    // Privy holds the identity's email and linked accounts, which we cannot reach
    // from here. Best-effort by design: failing to call Privy must not leave the
    // local account undeleted, so the outcome is recorded for follow-up instead.
    let privyDeletion: PurgeResult['privyDeletion'] = 'skipped';
    if (user.privyUserId) {
      try {
        await deleteLinkedPrivyIdentity(user.privyUserId);
        privyDeletion = 'succeeded';
      } catch (error) {
        privyDeletion = 'failed';
        warnings.push(`Privy identity deletion failed: ${(error as Error).message}`);
        logger.error({ err: error, userId }, 'Failed to delete linked Privy identity');
      }
    }

    await this.requestRepo.update({ userId }, { privyDeletionStatus: privyDeletion });

    logger.info({ userId, deleted, privyDeletion }, 'Account erased');

    return { userId, deleted, cacheKeysInvalidated, privyDeletion, warnings };
  }

  /** Drop cached artist/song data that still points at the erased account. */
  private async invalidateCaches(user: User, warnings: string[]): Promise<number> {
    let count = 0;
    try {
      await CacheService.invalidate(`artist:${user.id}`);
      count += 1;
    } catch (error) {
      warnings.push(`Failed to invalidate artist cache: ${(error as Error).message}`);
    }

    // Songs survive erasure, so any cached copy of their streaming manifests is
    // cleared to drop the former owner's attribution.
    if (user.role === UserRole.ARTIST) {
      try {
        await CacheService.invalidatePattern('song:*');
        count += 1;
      } catch (error) {
        warnings.push(`Failed to invalidate song cache: ${(error as Error).message}`);
      }
    }

    return count;
  }

  /**
   * Erase every account whose grace period has elapsed. Entry point for the
   * scheduled job.
   *
   * @param limit - Maximum accounts to process in one pass, so a large backlog
   *   cannot produce a single unbounded transaction.
   * @returns Per-account outcomes. A failure on one account does not stop the
   *   rest, and leaves that account for the next pass.
   */
  async processDueDeletions(
    limit = 100,
  ): Promise<Array<{ userId: string; ok: boolean; error?: string; result?: PurgeResult }>> {
    const due = await this.userRepo
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .where('user.deletedAt IS NULL')
      .andWhere('user.deletionRequestedAt IS NOT NULL')
      .andWhere('user.deletionScheduledFor IS NOT NULL')
      .andWhere('user.deletionScheduledFor <= :now', { now: new Date() })
      .orderBy('user.deletionScheduledFor', 'ASC')
      .take(limit)
      .getRawMany<{ id: string }>();

    const outcomes: Array<{ userId: string; ok: boolean; error?: string; result?: PurgeResult }> =
      [];

    for (const { id } of due) {
      try {
        const result = await this.purgeUser(id);
        outcomes.push({ userId: id, ok: true, result });
      } catch (error) {
        const message = (error as Error).message;
        logger.error({ err: error, userId: id }, 'Scheduled account erasure failed');
        await this.requestRepo.update(
          { userId: id, status: 'requested' },
          { status: 'failed' as AccountDeletionStatus, notes: message },
        );
        outcomes.push({ userId: id, ok: false, error: message });
      }
    }

    return outcomes;
  }
}
