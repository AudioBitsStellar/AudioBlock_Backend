process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost';
process.env.ENABLE_PRIVY_AUTH = 'true';
process.env.PRIVY_VERIFICATION_KEY = 'test-verification-key';

import request from 'supertest';
import AppDataSource from '../../src/config/db';
import app from '../../src/app';
import { User, UserRole } from '../../src/entities/User';

const redisStore = new Map<string, string>();

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    del: jest.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
  },
}));

jest.mock('../../src/services/EmailService', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    generateVerificationToken: jest.fn().mockReturnValue('verification-token'),
    generateResetToken: jest.fn().mockReturnValue('reset-token'),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('Login Flow Integration Tests (Issue #622)', () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.synchronize(true);
  });

  afterEach(async () => {
    await AppDataSource.synchronize(true);
    redisStore.clear();
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  const createPrivyToken = (payload: object = {}): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const data = {
      sub: 'privy_usr_integration_123',
      email: 'privy.user@audioblock.com',
      walletAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXY',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    };
    const body = Buffer.from(JSON.stringify(data)).toString('base64');
    return `${header}.${body}.mock_signature`;
  };

  describe('Privy Login Flow', () => {
    it('successfully logs in with a valid Privy ID token', async () => {
      const idToken = createPrivyToken();
      const res = await request(app)
        .post('/api/auth/privy/login')
        .send({ idToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('privy.user@audioblock.com');
    });

    it('rejects login request missing idToken with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/auth/privy/login')
        .send({})
        .expect(400);

      expect(res.body.message).toContain('Privy ID token is required');
    });

    it('rejects login with malformed idToken with authentication error', async () => {
      const res = await request(app)
        .post('/api/auth/privy/login')
        .send({ idToken: 'malformed.token.format.here' })
        .expect(401);

      expect(res.body.message).toBeDefined();
    });

    it('allows refreshing token with valid Privy authorization and refresh token', async () => {
      const idToken = createPrivyToken({ sub: 'user_refresh_test_id' });
      const loginRes = await request(app)
        .post('/api/auth/privy/login')
        .send({ idToken })
        .expect(200);

      const res = await request(app)
        .post('/api/auth/privy/refresh-token')
        .set('Authorization', `Bearer ${idToken}`)
        .send({ refreshToken: loginRes.body.refreshToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('allows logout with valid Privy authorization', async () => {
      const idToken = createPrivyToken({ sub: 'user_logout_test_id' });
      const res = await request(app)
        .post('/api/auth/privy/logout')
        .set('Authorization', `Bearer ${idToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('logout successful');
    });
  });

  describe('Standard Email & Nonce Login Flows', () => {
    it('retrieves user nonce for wallet login flow', async () => {
      const email = 'listener@example.com';
      const res = await request(app)
        .get(`/api/auth/nonce/${email}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Audioblocks Login');
      expect(res.body.message).toContain(email);
    });

    it('completes full email register, login, refresh, and logout flow', async () => {
      const userData = {
        email: 'flowuser@example.com',
        password: 'Password123!',
        username: 'flowuser',
        name: 'Flow User',
        role: 'listener',
      };

      // Register
      const regRes = await request(app)
        .post('/api/auth/register-email')
        .send(userData)
        .expect(201);
      expect(regRes.body.success).toBe(true);

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login-email')
        .send({ email: userData.email, password: userData.password })
        .expect(200);
      expect(loginRes.body.token).toBeDefined();
      expect(loginRes.body.refreshToken).toBeDefined();

      // Refresh
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken })
        .expect(200);
      expect(refreshRes.body.token).toBeDefined();

      // Logout
      await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: loginRes.body.refreshToken })
        .expect(200);
    });
  });
});
