import 'reflect-metadata';

// --- module mocks (hoisted before any imports) ---
jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/redis', () => ({
  __esModule: true,
  default: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
}));
jest.mock('bcrypt');
jest.mock('jsonwebtoken');
jest.mock('otplib', () => ({
  generateSecret: jest.fn().mockReturnValue('TOTPSECRET'),
  generateURI: jest.fn().mockReturnValue('otpauth://totp/AudioBlocks:a%40b.com?secret=TOTPSECRET'),
  verifySync: jest.fn().mockReturnValue({ valid: true }),
}));
jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr') },
}));
jest.mock('../services/AccountMergeService', () => ({
  AccountMergeService: jest.fn().mockImplementation(() => ({
    autoMergeDuringLogin: jest.fn().mockResolvedValue(null),
    detectDuplicates: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('../services/AuthAuditService', () => ({
  AuthAuditService: jest.fn().mockImplementation(() => ({
    logAuthEvent: jest.fn().mockResolvedValue(undefined),
  })),
}));

import AppDataSource from '../config/db';
import redis from '../config/redis';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/AuthService';
import { UserRole } from '../entities/User';
import { JobQueueService } from '../services/JobQueueService';

const mockUserRepo = {
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockRefreshTokenRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
    if (entity.name === 'RefreshToken') return mockRefreshTokenRepo;
    return mockUserRepo;
  });
});

describe('AuthService.registerWithEmail', () => {
  it('throws when the email is already taken', async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'existing' });
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({
        email: 'a@b.com',
        password: 'password123',
        role: UserRole.ARTIST,
        dateOfBirth: '1990-01-01',
      }),
    ).rejects.toThrow('User already exists');
  });

  it('creates user with hashed password and returns a JWT', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_pw');
    const created = {
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.ARTIST,
      passwordHash: 'hashed_pw',
    };
    mockUserRepo.create.mockReturnValue(created);
    mockUserRepo.save.mockResolvedValue(created);
    (jwt.sign as jest.Mock).mockReturnValue('jwt.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const { user, token } = await svc.registerWithEmail({
      email: 'a@b.com',
      password: 'password123',
      role: UserRole.ARTIST,
      dateOfBirth: '1990-01-01',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
    expect(mockUserRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com', passwordHash: 'hashed_pw' }),
    );
    expect(token).toBe('jwt.token');
    expect(user).toBe(created);
  });

  it('throws on validation error (short password)', async () => {
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({
        email: 'a@b.com',
        password: 'short',
        role: UserRole.ARTIST,
        dateOfBirth: '1990-01-01',
      }),
    ).rejects.toThrow();
  });
});

/** Returns a `YYYY-MM-DD` date of birth for someone exactly `years` old today (UTC). */
function dobForAge(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe('AuthService.registerWithEmail minimum-age gate (COMP-06)', () => {
  const originalMinimum = process.env.MINIMUM_SIGNUP_AGE;

  afterEach(() => {
    if (originalMinimum === undefined) delete process.env.MINIMUM_SIGNUP_AGE;
    else process.env.MINIMUM_SIGNUP_AGE = originalMinimum;
  });

  it('rejects a signup below the minimum age before any account lookup or write', async () => {
    delete process.env.MINIMUM_SIGNUP_AGE;
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({
        email: 'a@b.com',
        password: 'password123',
        role: UserRole.LISTENER,
        dateOfBirth: dobForAge(17),
      }),
    ).rejects.toThrow('You must be at least 18 years old to create an account.');
    expect(mockUserRepo.findOneBy).not.toHaveBeenCalled();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });

  it('honours a configured MINIMUM_SIGNUP_AGE', async () => {
    process.env.MINIMUM_SIGNUP_AGE = '16';
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({
        email: 'a@b.com',
        password: 'password123',
        role: UserRole.LISTENER,
        dateOfBirth: dobForAge(15),
      }),
    ).rejects.toThrow('You must be at least 16 years old');
  });

  it('rejects an impossible calendar date', async () => {
    const svc = new AuthService();
    await expect(
      svc.registerWithEmail({
        email: 'a@b.com',
        password: 'password123',
        role: UserRole.LISTENER,
        dateOfBirth: '1990-02-30',
      }),
    ).rejects.toThrow('valid past date');
  });

  it('accepts a signup exactly at the minimum age and never stores the date of birth', async () => {
    delete process.env.MINIMUM_SIGNUP_AGE;
    mockUserRepo.findOneBy.mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_pw');
    const created = { id: 'u2', email: 'a@b.com', role: UserRole.LISTENER };
    mockUserRepo.create.mockReturnValue(created);
    mockUserRepo.save.mockResolvedValue(created);
    (jwt.sign as jest.Mock).mockReturnValue('jwt.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    await svc.registerWithEmail({
      email: 'a@b.com',
      password: 'password123',
      role: UserRole.LISTENER,
      dateOfBirth: dobForAge(18),
    });

    const createdArg = mockUserRepo.create.mock.calls[0][0] as Record<string, unknown>;
    expect(createdArg).not.toHaveProperty('dateOfBirth');
  });
});

describe('AuthService.resendVerificationEmail (PROD-04)', () => {
  let enqueueSpy: jest.SpyInstance;

  beforeEach(() => {
    enqueueSpy = jest.spyOn(JobQueueService, 'enqueue').mockResolvedValue('job-1' as any);
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
  });

  it('is a silent no-op for an unknown address', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.resendVerificationEmail('nobody@b.com')).resolves.toBeUndefined();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('is a silent no-op for an already verified account', async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1', emailVerified: true, passwordHash: 'h' });
    const svc = new AuthService();
    await svc.resendVerificationEmail('a@b.com');
    expect(mockUserRepo.save).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('is a silent no-op for a wallet-only account with no password', async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1', emailVerified: false });
    const svc = new AuthService();
    await svc.resendVerificationEmail('a@b.com');
    expect(mockUserRepo.save).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('replaces the token with a fresh 24-hour one and queues the email', async () => {
    const user: Record<string, unknown> = {
      id: 'u1',
      emailVerified: false,
      passwordHash: 'h',
      emailVerificationToken: 'stale-token',
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    mockUserRepo.save.mockResolvedValue(user);

    const svc = new AuthService();
    await svc.resendVerificationEmail('a@b.com');

    const token = user.emailVerificationToken as string;
    expect(token).not.toBe('stale-token');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const expiry = (user.emailVerificationTokenExpiry as Date).getTime();
    expect(expiry).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(enqueueSpy).toHaveBeenCalledWith(
      'email.send',
      expect.objectContaining({
        to: 'a@b.com',
        html: expect.stringContaining(`/verify-email/${token}`),
      }),
      expect.anything(),
    );
  });
});

describe('AuthService.resetPassword session and verification effects (PROD-04)', () => {
  it('revokes every refresh token and marks the mailbox as verified', async () => {
    const user: Record<string, unknown> = {
      id: 'u1',
      emailVerified: false,
      passwordResetToken: 'tok',
      passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    };
    mockUserRepo.findOne.mockResolvedValue(user);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new_hash');
    mockUserRepo.save.mockResolvedValue(user);

    const svc = new AuthService();
    await svc.resetPassword('tok', 'newpassword123');

    expect(mockRefreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'u1' }, { revoked: true });
    expect(user.emailVerified).toBe(true);
  });
});

describe('AuthService.loginWithEmail', () => {
  it('throws when user does not exist', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.loginWithEmail({ email: 'a@b.com', password: 'password123' })).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('throws when password does not match', async () => {
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1', passwordHash: 'hashed' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const svc = new AuthService();
    await expect(svc.loginWithEmail({ email: 'a@b.com', password: 'wrongpass' })).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('returns user and token on valid credentials', async () => {
    const user = { id: 'u1', email: 'a@b.com', passwordHash: 'hashed', role: UserRole.ARTIST };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('jwt.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const result = await svc.loginWithEmail({ email: 'a@b.com', password: 'password123' });

    if (result.twoFactorRequired) {
      throw new Error('Did not expect 2FA challenge');
    }
    expect(result.token).toBe('jwt.token');
    expect(result.user).toBe(user);
  });

  it('requires a second factor when 2FA is enabled', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      passwordHash: 'hashed',
      role: UserRole.ARTIST,
      twoFactorEnabled: true,
      twoFactorSecret: 'SECRET',
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('partial.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const result = await svc.loginWithEmail({ email: 'a@b.com', password: 'password123' });

    expect(result).toEqual({
      twoFactorRequired: true,
      partialToken: 'partial.token',
      user: { id: 'u1', email: 'a@b.com', role: UserRole.ARTIST },
    });
  });

  it('accepts and consumes a valid recovery code', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      passwordHash: 'hashed',
      role: UserRole.ARTIST,
      twoFactorEnabled: true,
      twoFactorRecoveryCodeHashes: ['hashed_recovery'],
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    mockUserRepo.save.mockResolvedValue(user);
    (jwt.sign as jest.Mock).mockReturnValue('jwt.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const result = await svc.loginWithEmail({
      email: 'a@b.com',
      password: 'password123',
      recoveryCode: 'abcde-fghij',
    });

    expect(mockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ twoFactorRecoveryCodeHashes: [] }),
    );
    expect(result).toEqual({ user, token: 'jwt.token' });
  });
});

describe('AuthService.getNonce', () => {
  it('throws when email is missing', async () => {
    const svc = new AuthService();
    await expect(svc.getNonce('')).rejects.toThrow('Email is required');
  });

  it('stores nonce in redis with 5-minute TTL and returns it', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.get as jest.Mock).mockResolvedValue('abc123');

    const svc = new AuthService();
    const nonce = await svc.getNonce('a@b.com');

    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
    expect(redis.set).toHaveBeenCalledWith('nonce:a@b.com', expect.any(String), 'EX', 300);
  });
});

describe('AuthService.forgotPassword', () => {
  it('silently returns without issuing a token when the email is unknown', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.forgotPassword('nobody@b.com')).resolves.toBeUndefined();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });

  it('issues a URL-safe token with a 1-hour expiry and invalidates any prior token', async () => {
    const user: Record<string, unknown> = {
      id: 'u1',
      email: 'a@b.com',
      passwordResetToken: 'stale-token',
      passwordResetTokenExpiry: new Date(0),
    };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    mockUserRepo.save.mockResolvedValue(user);

    const before = Date.now();
    const svc = new AuthService();
    await svc.forgotPassword('a@b.com');
    const after = Date.now();

    const token = user.passwordResetToken as string;
    expect(token).not.toBe('stale-token');
    // base64url alphabet only — safe to embed in a link without encoding.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const expiry = (user.passwordResetTokenExpiry as Date).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(expiry).toBeLessThanOrEqual(after + 60 * 60 * 1000);
    expect(mockUserRepo.save).toHaveBeenCalledWith(user);
  });
});

describe('AuthService.resetPassword', () => {
  it('throws when the token does not match any user', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.resetPassword('bad-token', 'newpassword123')).rejects.toThrow(
      'Invalid reset token',
    );
  });

  it('throws when the token has expired', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'u1',
      passwordResetToken: 'tok',
      passwordResetTokenExpiry: new Date(Date.now() - 1000),
    });
    const svc = new AuthService();
    await expect(svc.resetPassword('tok', 'newpassword123')).rejects.toThrow(
      'Reset token has expired',
    );
  });

  it('hashes the new password and clears the reset token on success', async () => {
    const user: Record<string, unknown> = {
      id: 'u1',
      passwordResetToken: 'tok',
      passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    };
    mockUserRepo.findOne.mockResolvedValue(user);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new_hash');
    mockUserRepo.save.mockResolvedValue(user);

    const svc = new AuthService();
    await svc.resetPassword('tok', 'newpassword123');

    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
    expect(user.passwordHash).toBe('new_hash');
    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetTokenExpiry).toBeUndefined();
    expect(mockUserRepo.save).toHaveBeenCalledWith(user);
  });
});

describe('AuthService.login (wallet-signature flow)', () => {
  it('throws on invalid or expired nonce', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    const svc = new AuthService();
    await expect(
      svc.login({
        email: 'a@b.com',
        message: 'Sign in\nNonce: abc123',
        signature: '0xsig',
        role: 'listener',
      }),
    ).rejects.toThrow('Invalid or expired nonce');
  });

  it('returns user and token when nonce matches', async () => {
    (redis.get as jest.Mock).mockResolvedValue('abc123');
    (redis.del as jest.Mock).mockResolvedValue(1);
    const user = { id: 'u1', email: 'a@b.com', role: UserRole.ARTIST };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    (jwt.sign as jest.Mock).mockReturnValue('jwt.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const result = await svc.login({
      email: 'a@b.com',
      message: 'Sign in\nNonce: abc123',
      signature: '0xsig',
      role: 'artist',
    });

    expect(redis.del).toHaveBeenCalledWith('nonce:a@b.com');
    expect(result.token).toBe('jwt.token');
  });
});

describe('AuthService.privyRefreshToken', () => {
  const user = { id: 'u1', email: 'a@b.com', role: UserRole.ARTIST };
  const validRt = {
    id: 'rt1',
    token: 'refresh-token-abc',
    userId: 'u1',
    familyId: 'fam-1',
    revoked: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  it('throws when userId or refreshToken is missing', async () => {
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('', 'tok')).rejects.toThrow(
      'User ID and refresh token required',
    );
    await expect(svc.privyRefreshToken('u1', '')).rejects.toThrow(
      'User ID and refresh token required',
    );
  });

  it('throws when user is not found', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('u1', 'tok')).rejects.toThrow('User not found');
  });

  it('throws when refresh token is not in the database', async () => {
    mockUserRepo.findOne.mockResolvedValue(user);
    mockRefreshTokenRepo.findOne.mockResolvedValue(null);
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('u1', 'bad-token')).rejects.toThrow('Invalid refresh token');
  });

  it('throws and revokes family when token belongs to a different user', async () => {
    mockUserRepo.findOne.mockResolvedValue(user);
    mockRefreshTokenRepo.findOne.mockResolvedValue({ ...validRt, userId: 'other-user' });
    mockRefreshTokenRepo.update.mockResolvedValue(undefined);
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('u1', validRt.token)).rejects.toThrow(
      'Invalid refresh token',
    );
    expect(mockRefreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'u1' }, { revoked: true });
  });

  it('throws and revokes family on reuse detection', async () => {
    mockUserRepo.findOne.mockResolvedValue(user);
    mockRefreshTokenRepo.findOne.mockResolvedValue({ ...validRt, revoked: true });
    mockRefreshTokenRepo.update.mockResolvedValue(undefined);
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('u1', validRt.token)).rejects.toThrow(
      'Refresh token reuse detected',
    );
    expect(mockRefreshTokenRepo.update).toHaveBeenCalledWith(
      { familyId: 'fam-1' },
      { revoked: true },
    );
  });

  it('throws when refresh token has expired', async () => {
    mockUserRepo.findOne.mockResolvedValue(user);
    mockRefreshTokenRepo.findOne.mockResolvedValue({
      ...validRt,
      expiresAt: new Date(Date.now() - 1000),
    });
    const svc = new AuthService();
    await expect(svc.privyRefreshToken('u1', validRt.token)).rejects.toThrow(
      'Refresh token expired',
    );
  });

  it('rotates the refresh token and returns a new access token', async () => {
    mockUserRepo.findOne.mockResolvedValue(user);
    mockRefreshTokenRepo.findOne.mockResolvedValue(validRt);
    mockRefreshTokenRepo.save.mockResolvedValue(undefined);
    mockRefreshTokenRepo.create.mockImplementation((args: any) => args);
    (jwt.sign as jest.Mock).mockReturnValue('new.access.token');
    process.env.JWT_SECRET = 'test_secret';

    const svc = new AuthService();
    const result = await svc.privyRefreshToken('u1', validRt.token);

    expect(result.accessToken).toBe('new.access.token');
    expect(result.refreshToken).toBeDefined();
    expect(mockRefreshTokenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ revoked: true }),
    );
  });
});
