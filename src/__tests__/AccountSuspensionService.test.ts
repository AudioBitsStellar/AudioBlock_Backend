import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn(), isInitialized: true },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../services/CacheService', () => ({
  CacheService: { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() },
}));

import AppDataSource from '../config/db';
import { CacheService } from '../services/CacheService';
import { AccountSuspensionService } from '../services/AccountSuspensionService';
import { AccountSuspensionType, UserRole } from '../entities/User';

const dataSource = AppDataSource as unknown as {
  isInitialized: boolean;
  getRepository: jest.Mock;
};

const adminId = '55555555-5555-4555-8555-555555555555';
const targetId = '66666666-6666-4666-8666-666666666666';

const mockUserRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  dataSource.isInitialized = true;
  dataSource.getRepository.mockImplementation(() => mockUserRepo);
});

describe('AccountSuspensionService.isSuspended (#980)', () => {
  it('treats every account as active when the data source is not initialised', async () => {
    dataSource.isInitialized = false;

    await expect(AccountSuspensionService.isSuspended(targetId)).resolves.toBe(false);
    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
  });

  it('serves a cached suspension state without querying the database', async () => {
    (CacheService.get as jest.Mock).mockResolvedValueOnce({ suspended: true });

    await expect(AccountSuspensionService.isSuspended(targetId)).resolves.toBe(true);
    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
  });

  it('reads a suspended account from the database and caches the result', async () => {
    (CacheService.get as jest.Mock).mockResolvedValueOnce(null);
    mockUserRepo.findOne.mockResolvedValueOnce({ id: targetId, suspendedAt: new Date() });

    await expect(AccountSuspensionService.isSuspended(targetId)).resolves.toBe(true);
    expect(CacheService.set).toHaveBeenCalledWith(
      `account:suspension:${targetId}`,
      { suspended: true },
      expect.any(Number),
    );
  });

  it('treats an active account as not suspended', async () => {
    (CacheService.get as jest.Mock).mockResolvedValueOnce(null);
    mockUserRepo.findOne.mockResolvedValueOnce({ id: targetId, suspendedAt: null });

    await expect(AccountSuspensionService.isSuspended(targetId)).resolves.toBe(false);
  });

  it('returns false without a user id', async () => {
    await expect(AccountSuspensionService.isSuspended(undefined)).resolves.toBe(false);
    expect(CacheService.get).not.toHaveBeenCalled();
  });
});

describe('AccountSuspensionService.suspend (#980)', () => {
  it('refuses to let an admin suspend their own account', async () => {
    await expect(
      AccountSuspensionService.suspend(
        { id: adminId, role: UserRole.SUPER_ADMIN },
        adminId,
        { type: AccountSuspensionType.BANNED, reason: 'test' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SELF_SUSPENSION' });
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('reports a missing target as not found', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      AccountSuspensionService.suspend({ id: adminId, role: UserRole.ADMIN }, targetId, {
        type: AccountSuspensionType.SUSPENDED,
        reason: 'spam',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });

  it('stops a plain admin from restricting another admin', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: targetId, role: UserRole.ADMIN });

    await expect(
      AccountSuspensionService.suspend({ id: adminId, role: UserRole.ADMIN }, targetId, {
        type: AccountSuspensionType.BANNED,
        reason: 'abuse',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SUSPENSION_FORBIDDEN' });
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('lets a super admin restrict an admin and invalidates the cached state', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: targetId, role: UserRole.ADMIN });

    const state = await AccountSuspensionService.suspend(
      { id: adminId, role: UserRole.SUPER_ADMIN },
      targetId,
      { type: AccountSuspensionType.SUSPENDED, reason: 'review' },
    );

    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { id: targetId },
      expect.objectContaining({
        suspendedBy: adminId,
        suspensionType: AccountSuspensionType.SUSPENDED,
        suspensionReason: 'review',
      }),
    );
    expect(state).toMatchObject({ id: targetId, suspensionType: 'suspended' });
    expect(CacheService.invalidate).toHaveBeenCalledWith(`account:suspension:${targetId}`);
  });
});

describe('AccountSuspensionService.reinstate (#980)', () => {
  it('clears the restriction and invalidates the cached state', async () => {
    mockUserRepo.update.mockResolvedValueOnce({ affected: 1 });

    await AccountSuspensionService.reinstate(targetId);

    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { id: targetId },
      { suspendedAt: null, suspendedBy: null, suspensionType: null, suspensionReason: null },
    );
    expect(CacheService.invalidate).toHaveBeenCalledWith(`account:suspension:${targetId}`);
  });

  it('reports an unknown user as not found', async () => {
    mockUserRepo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(AccountSuspensionService.reinstate(targetId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
