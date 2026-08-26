import jwt from 'jsonwebtoken';

export interface TestJwtPayload {
  id: string;
  role?: string;
  email?: string;
  walletAddress?: string;
  stellarPublicKey?: string;
  username?: string;
  name?: string;
  emailVerified?: boolean;
  [claim: string]: unknown;
}

const DEFAULT_TEST_JWT_SECRET = 'test-secret';

/**
 * Ensures JWT_SECRET is set for the current process (defaults to
 * 'test-secret' if unset). Idempotent. Both AuthService.signToken and
 * authMiddleware.requireAuth read process.env.JWT_SECRET at call time,
 * so a single shared default keeps sign/verify consistent without every
 * test file re-declaring its own beforeAll/afterAll.
 */
export function getTestJwtSecret(): string {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = DEFAULT_TEST_JWT_SECRET;
  }
  return process.env.JWT_SECRET;
}

/**
 * Signs a JWT matching the shape authMiddleware.requireAuth expects,
 * using the same JWT_SECRET it will read at verify time.
 */
export function generateAuthToken(
  userId: string = 'test-user-1',
  overrides: Partial<TestJwtPayload> = {},
): string {
  const secret = getTestJwtSecret();
  const payload: TestJwtPayload = { id: userId, ...overrides };
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}
