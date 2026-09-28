import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../CacheService', () => ({
  CacheService: { invalidate: jest.fn(), invalidatePattern: jest.fn() },
}));
jest.mock('../privy/PrivyIdentityService', () => ({
  deleteLinkedPrivyIdentity: jest.fn(),
}));

import { DataSource } from 'typeorm';
import { AccountDeletionService } from '../AccountDeletionService';
import { User, UserRole } from '../../entities/User';
import { CacheService } from '../CacheService';
import { deleteLinkedPrivyIdentity } from '../privy/PrivyIdentityService';

/** A user fixture with every field the anonymiser touches. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'listener@example.com',
    username: 'listener',
    name: 'A Listener',
    bio: 'bio text',
    role: UserRole.LISTENER,
    passwordHash: 'hash',
    twoFactorSecret: 'totp',
    twoFactorRecoveryCodeHashes: ['a'],
    emailVerificationToken: 'tok',
    emailVerificationTokenExpiry: new Date(),
    passwordResetToken: 'rt',
    passwordResetTokenExpiry: new Date(),
    walletAddress: '0xabc',
    stellarPublicKey: 'GABC',
    profileImage: 'https://img',
    avatarIpfsHash: 'ipfs',
    pageCover: 'https://cover',
    website: 'https://site',
    twitterId: 'tw',
    twitterUsername: 'tw',
    twitterDisplayName: 'TW',
    twitterProfileImage: 'https://tw',
    facebookId: 'fb',
    facebookName: 'FB',
    facebookEmail: 'fb@example.com',
    facebookProfileImage: 'https://fb',
    emailVerified: true,
    twoFactorEnabled: true,
    ...overrides,
  } as User;
}

describe('AccountDeletionService (#633)', () => {
  const originalEnv = { ...process.env };
  let dataSource: DataSource;
  let userRepo: { findOneBy: jest.Mock; createQueryBuilder: jest.Mock; update: jest.Mock };
  let requestRepo: { findOne: jest.Mock; update: jest.Mock; insert: jest.Mock; create: jest.Mock };
  let service: AccountDeletionService;
  let manager: { query: jest.Mock; getRepository: jest.Mock; transaction: unknown };
  /** Every SQL statement issued, for assertions. */
  let statements: Array<{ sql: string; params?: unknown[] }>;
  let refreshTokenRepo: { update: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS = '30';
    statements = [];

    userRepo = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn(),
    };
    requestRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    };

    refreshTokenRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    manager = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        return Promise.resolve([]);
      }),
      // Mirrors the repositories the service touches inside its transaction.
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === 'refresh_tokens') return refreshTokenRepo;
        return requestRepo;
      }),
      transaction: jest.fn(),
    };

    dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return userRepo;
        return requestRepo;
      }),
      query: jest.fn((sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        return Promise.resolve([]);
      }),
    } as unknown as DataSource;

    // The service wraps its work in a transaction; run the callback against the
    // stub manager so the SQL is observable.
    (dataSource as unknown as { transaction: unknown }).transaction = jest.fn(
      async (cb: (m: unknown) => Promise<void>) => cb(manager),
    );

    service = new AccountDeletionService(dataSource);
  });

  afterEach(() => {
    delete process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS;
    Object.assign(process.env, originalEnv);
  });

  describe('requestDeletion', () => {
    it('rejects an unknown user', async () => {
      userRepo.findOneBy.mockResolvedValue(null);
      await expect(service.requestDeletion('nope')).rejects.toThrow('User not found');
    });

    it('rejects a request for an already-deleted account', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ deletedAt: new Date() }));
      await expect(service.requestDeletion('user-1')).rejects.toThrow('already been deleted');
    });

    it('schedules erasure after the grace window and returns a reference id', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      requestRepo.findOne.mockResolvedValue(null);

      const result = await service.requestDeletion('user-1', 'moving on');

      expect(result.gracePeriodDays).toBe(30);
      expect(result.referenceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.scheduledFor.getTime()).toBeGreaterThan(result.requestedAt.getTime());

      const updateCall = userRepo.update.mock.calls[0];
      expect(updateCall[0]).toEqual({ id: 'user-1' });
      expect(updateCall[1]).toMatchObject({ deletionReason: 'moving on' });
    });

    it('honours a configured grace period', async () => {
      process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS = '7';
      userRepo.findOneBy.mockResolvedValue(makeUser());
      requestRepo.findOne.mockResolvedValue(null);

      const result = await service.requestDeletion('user-1');
      expect(result.gracePeriodDays).toBe(7);
    });

    it('is idempotent: a second call does not reset the clock', async () => {
      // Otherwise a user could accidentally extend their own deadline, and a
      // retrying client would silently postpone an erasure they asked for.
      const existing = {
        referenceId: 'ref-1',
        requestedAt: new Date('2026-01-01'),
        gracePeriodEndsAt: new Date('2026-01-31'),
      };
      userRepo.findOneBy.mockResolvedValue(makeUser());
      requestRepo.findOne.mockResolvedValue(existing);

      const result = await service.requestDeletion('user-1');

      expect(result.referenceId).toBe('ref-1');
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('revokes live sessions immediately rather than at the end of the grace window', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      requestRepo.findOne.mockResolvedValue(null);

      await service.requestDeletion('user-1');

      expect(refreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { revoked: true });
    });
  });

  describe('cancelDeletion', () => {
    it('clears the pending state and marks the audit row cancelled', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ deletionRequestedAt: new Date() }));

      await service.cancelDeletion('user-1');

      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        expect.objectContaining({ deletionRequestedAt: null, deletionScheduledFor: null }),
      );
      expect(requestRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1', status: 'requested' },
        { status: 'cancelled' },
      );
    });

    it('rejects when there is nothing to cancel', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      await expect(service.cancelDeletion('user-1')).rejects.toThrow('No pending deletion request');
    });

    it('refuses to "restore" an account that has already been erased', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ deletedAt: new Date() }));
      await expect(service.cancelDeletion('user-1')).rejects.toThrow('cannot be restored');
    });
  });

  describe('purgeUser', () => {
    it('refuses when no deletion was requested', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      await expect(service.purgeUser('user-1')).rejects.toThrow('No pending deletion request');
    });

    it('refuses to erase before the grace period has elapsed', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );

      await expect(service.purgeUser('user-1')).rejects.toThrow('grace period has not elapsed');
    });

    it('erases once the grace period has passed', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
          deletionScheduledFor: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        }),
      );

      const result = await service.purgeUser('user-1');

      expect(result.userId).toBe('user-1');
      const anonymise = statements.find((s) => s.sql.includes('UPDATE "users"'));
      expect(anonymise).toBeDefined();
    });

    it('force bypasses both the request and the grace period', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      await expect(service.purgeUser('user-1', { force: true })).resolves.toBeDefined();
    });

    it('anonymises the user row instead of deleting it', async () => {
      // Deleting the row would destroy the audit trail for already-paid royalties
      // and orphan on-chain NFTs that still exist (Art. 17(3)(b)/(e)).
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      const sql = statements.map((s) => s.sql).join('\n');
      expect(sql).not.toMatch(/DELETE FROM "users"/);
      expect(sql).toMatch(/UPDATE "users" SET "deletedAt"/);
    });

    it('nulls every identifying field on the user row', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      const update = statements.find((s) => s.sql.includes('UPDATE "users"'));
      const sql = update!.sql;
      for (const field of [
        'email',
        'username',
        'name',
        'bio',
        'passwordHash',
        'twoFactorSecret',
        'walletAddress',
        'twitterId',
        'facebookEmail',
        'privyUserId',
      ]) {
        expect(sql).toContain(`"${field}" = $`);
      }
      // Params are [deletedAt, role, isProfilePublic, ...anonymised, userId];
      // every anonymised value must be NULL and the user id the last bind param.
      const params = update!.params!;
      const anonymised = params.slice(3, -1);
      expect(anonymised).toEqual(new Array(anonymised.length).fill(null));
      expect(params[params.length - 1]).toBe('user-1');
    });

    it('deletes credentials rather than leaving them live', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      const sql = statements.map((s) => s.sql);
      expect(sql).toContain('DELETE FROM "api_keys" WHERE "userId" = $1');
      expect(sql).toContain('DELETE FROM "refresh_tokens" WHERE "userId" = $1');
      expect(sql).toContain('DELETE FROM "webhook_subscriptions" WHERE "userId" = $1');
    });

    it('purges both sides of the follow graph', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      const sql = statements.map((s) => s.sql);
      expect(sql).toContain('DELETE FROM "user_follows" WHERE "followerId" = $1');
      expect(sql).toContain('DELETE FROM "user_follows" WHERE "followingId" = $1');
    });

    it('retains on-chain and financial records', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      const sql = statements.map((s) => s.sql);
      expect(sql).not.toContain('DELETE FROM "royalty_payouts" WHERE "artist_id" = $1');
      expect(sql).not.toContain('DELETE FROM "songs" WHERE "artistId" = $1');
      expect(sql).not.toContain('DELETE FROM "transaction_logs" WHERE "user_id" = $1');
    });

    it('records a warning and continues when one table cannot be purged', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );
      manager.query.mockImplementation((sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (sql.includes('"api_keys"')) return Promise.reject(new Error('permission denied'));
        return Promise.resolve([]);
      });

      const result = await service.purgeUser('user-1');

      // The erasure still completed, and the failure is visible for follow-up.
      expect(result.warnings.join(' ')).toMatch(/api_keys/);
      expect(statements.map((s) => s.sql)).toContain(
        'DELETE FROM "refresh_tokens" WHERE "userId" = $1',
      );
    });

    it('is idempotent for an already-erased account', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ deletedAt: new Date() }));
      const result = await service.purgeUser('user-1');
      expect(result.warnings.join(' ')).toMatch(/no-op/);
    });

    it('deletes the linked Privy identity when there is one', async () => {
      (deleteLinkedPrivyIdentity as jest.Mock).mockResolvedValue(true);
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          privyUserId: 'did:privy:abc',
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      const result = await service.purgeUser('user-1');

      expect(deleteLinkedPrivyIdentity).toHaveBeenCalledWith('did:privy:abc');
      expect(result.privyDeletion).toBe('succeeded');
    });

    it('completes the local erasure even when the Privy deletion fails', async () => {
      // A failed upstream call must not strand the data-subject request; the
      // failure is recorded for follow-up instead.
      (deleteLinkedPrivyIdentity as jest.Mock).mockRejectedValue(new Error('Privy 500'));
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          privyUserId: 'did:privy:abc',
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      const result = await service.purgeUser('user-1');

      expect(result.privyDeletion).toBe('failed');
      expect(result.warnings.join(' ')).toMatch(/Privy identity deletion failed/);
      expect(requestRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1' },
        { privyDeletionStatus: 'failed' },
      );
    });

    it('skips the Privy call for an account that was never linked', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      const result = await service.purgeUser('user-1');

      expect(deleteLinkedPrivyIdentity).not.toHaveBeenCalled();
      expect(result.privyDeletion).toBe('skipped');
    });

    it('invalidates the artist cache so cached copies lose the attribution', async () => {
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          role: UserRole.ARTIST,
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      await service.purgeUser('user-1');

      expect(CacheService.invalidate).toHaveBeenCalledWith('artist:user-1');
      expect(CacheService.invalidatePattern).toHaveBeenCalledWith('song:*');
    });
  });

  describe('exportUserData (Art. 15/20)', () => {
    it('returns the caller profile alongside their content and activity', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());

      const data = await service.exportUserData('user-1');

      expect(data.account).toMatchObject({ id: 'user-1', email: 'listener@example.com' });
      expect(data).toHaveProperty('content.songs');
      expect(data).toHaveProperty('content.comments');
      expect(data).toHaveProperty('social.following');
      expect(data).toHaveProperty('activity.playEvents');
      expect(data).toHaveProperty('financial.royaltyPayouts');
    });

    it('records that the user exercised their portability right', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      await service.exportUserData('user-1');
      expect(requestRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { dataExported: true });
    });

    it('refuses for a deleted account', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ deletedAt: new Date() }));
      await expect(service.exportUserData('user-1')).rejects.toThrow('no personal data remains');
    });

    it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
      'refuses for role %s, which must go through the audited admin path',
      async (role) => {
        userRepo.findOneBy.mockResolvedValue(makeUser({ role }));
        await expect(service.exportUserData('user-1')).rejects.toThrow(
          'audited admin data-access path',
        );
      },
    );

    it('keeps going when an optional table is missing from the deployment', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      (dataSource.query as jest.Mock).mockImplementation((sql: string) =>
        sql.includes('"playlists"')
          ? Promise.reject(new Error('relation does not exist'))
          : Promise.resolve([]),
      );

      const data = await service.exportUserData('user-1');
      expect(data).toHaveProperty('content');
    });
  });

  describe('processDueDeletions', () => {
    const dueQuery = (ids: string[]) => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    });

    it('erases only accounts past their grace period', async () => {
      userRepo.createQueryBuilder.mockReturnValue(dueQuery(['user-1']));
      userRepo.findOneBy.mockResolvedValue(
        makeUser({
          deletionRequestedAt: new Date(Date.now() - 1000),
          deletionScheduledFor: new Date(Date.now() - 1000),
        }),
      );

      const outcomes = await service.processDueDeletions();

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ userId: 'user-1', ok: true });
    });

    it('does not let one failure block the rest of the batch', async () => {
      userRepo.createQueryBuilder.mockReturnValue(dueQuery(['bad', 'good']));
      userRepo.findOneBy
        .mockResolvedValueOnce(null) // 'bad' → not found
        .mockResolvedValue(
          makeUser({
            deletionRequestedAt: new Date(Date.now() - 1000),
            deletionScheduledFor: new Date(Date.now() - 1000),
          }),
        );

      const outcomes = await service.processDueDeletions();

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0].ok).toBe(false);
      expect(outcomes[1].ok).toBe(true);
    });

    it('marks a failed attempt so the next pass retries it', async () => {
      userRepo.createQueryBuilder.mockReturnValue(dueQuery(['bad']));
      userRepo.findOneBy.mockResolvedValue(null);

      await service.processDueDeletions();

      expect(requestRepo.update).toHaveBeenCalledWith(
        { userId: 'bad', status: 'requested' },
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
