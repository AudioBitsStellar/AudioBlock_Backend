import 'reflect-metadata';

const mockCreateLogEntry = jest.fn();

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../TransactionLogService', () => ({
  TransactionLogService: jest.fn().mockImplementation(() => ({
    createLogEntry: (...args: unknown[]) => mockCreateLogEntry(...args),
  })),
}));

import AppDataSource from '../../config/db';
import { UserRole } from '../../entities/User';
import { SupportUserService, SUPPORT_USER_LOOKUP_ACTION } from '../Support/SupportUserService';

const ADMIN_ID = 'admin-1';
const UUID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

// A row as an unrestricted query would return it, secrets included. The service
// must not release these fields even if the database hands them back.
const ROW = {
  id: 'user-1',
  username: 'ada',
  email: 'ada@example.com',
  role: UserRole.ARTIST,
  emailVerified: true,
  twoFactorEnabled: true,
  isVerified: false,
  walletAddress: null,
  stellarPublicKey: 'GADA',
  privyUserId: 'did:privy:abc',
  payoutHoldReason: null,
  payoutHoldPlacedAt: null,
  deletionRequestedAt: null,
  deletionScheduledFor: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  passwordHash: 'bcrypt-hash',
  twoFactorSecret: 'totp-secret',
  twoFactorRecoveryCodeHashes: ['hash-1'],
  passwordResetToken: 'reset-token',
  emailVerificationToken: 'verify-token',
};

const SECRET_FIELDS = [
  'passwordHash',
  'twoFactorSecret',
  'twoFactorRecoveryCodeHashes',
  'passwordResetToken',
  'emailVerificationToken',
  'privyUserId',
];

describe('SupportUserService.lookupUser (#983)', () => {
  let mockUserRepo: { findOne: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepo = { findOne: jest.fn() };
    (AppDataSource.getRepository as jest.Mock).mockImplementation(() => mockUserRepo);
  });

  it('returns an allowlisted view and audits the lookup', async () => {
    mockUserRepo.findOne.mockResolvedValue(ROW);

    const result = await new SupportUserService().lookupUser('ada@example.com', ADMIN_ID);

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'ada@example.com',
      role: UserRole.ARTIST,
      privyLinked: true,
      payoutHold: { active: false, reason: null, placedAt: null },
    });
    for (const field of SECRET_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
    expect(mockCreateLogEntry).toHaveBeenCalledWith(
      ADMIN_ID,
      '',
      SUPPORT_USER_LOOKUP_ACTION,
      'target=user-1',
    );
  });

  it('selects only allowlisted columns from the database', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    await new SupportUserService().lookupUser('ada@example.com', ADMIN_ID);

    const { select } = mockUserRepo.findOne.mock.calls[0][0];
    for (const field of SECRET_FIELDS.filter((f) => f !== 'privyUserId')) {
      expect(select).not.toHaveProperty(field);
    }
  });

  it('returns null and still audits when nothing matches', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    await expect(
      new SupportUserService().lookupUser('nobody@example.com', ADMIN_ID),
    ).resolves.toBeNull();
    expect(mockCreateLogEntry).toHaveBeenCalledWith(
      ADMIN_ID,
      '',
      SUPPORT_USER_LOOKUP_ACTION,
      'target=none',
    );
  });

  it('releases no data when the audit write fails', async () => {
    mockUserRepo.findOne.mockResolvedValue(ROW);
    mockCreateLogEntry.mockRejectedValueOnce(new Error('audit store unavailable'));

    await expect(
      new SupportUserService().lookupUser('ada@example.com', ADMIN_ID),
    ).rejects.toThrow('audit store unavailable');
  });

  it('rejects an empty query without touching the database or the audit log', async () => {
    await expect(new SupportUserService().lookupUser('   ', ADMIN_ID)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    expect(mockCreateLogEntry).not.toHaveBeenCalled();
  });

  it('rejects a query longer than 255 characters', async () => {
    await expect(
      new SupportUserService().lookupUser('a'.repeat(256), ADMIN_ID),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
  });

  it('adds an id clause only when the query is a UUID', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    const service = new SupportUserService();

    await service.lookupUser(UUID, ADMIN_ID);
    expect(mockUserRepo.findOne.mock.calls[0][0].where).toContainEqual({ id: UUID });

    mockUserRepo.findOne.mockClear();
    await service.lookupUser('not-a-uuid', ADMIN_ID);
    const where: Array<Record<string, unknown>> = mockUserRepo.findOne.mock.calls[0][0].where;
    expect(where.some((clause) => 'id' in clause)).toBe(false);
  });

  it('keeps the query text out of the audit entry', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    await new SupportUserService().lookupUser('ada@example.com', ADMIN_ID);

    const description = mockCreateLogEntry.mock.calls[0][3];
    expect(description).not.toContain('ada@example.com');
  });
});
