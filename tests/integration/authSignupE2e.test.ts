process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost:3000';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import AppDataSource from '../../src/config/db';
import app from '../../src/app';
import { User } from '../../src/entities/User';

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
    // rate-limit-redis issues commands through the ioredis `call` API.
    call: jest.fn(async () => 'OK'),
  },
}));

jest.mock('../../src/services/EmailService', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    generateVerificationToken: jest.fn().mockReturnValue('verification-token'),
    generateResetToken: jest.fn().mockReturnValue('reset-token'),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  })),
}));

// The Dynamic Labs wallet SDK loads a win32-only native module at import time.
// It is unrelated to the auth flow under test but is pulled in through app.ts
// → walletRoutes, so stub it to keep this suite runnable on every platform.
jest.mock('@dynamic-labs-wallet/node-evm', () => ({
  DynamicEvmWalletClient: class DynamicEvmWalletClient {},
}));

const signupPayload = {
  email: 'signup-flow@example.com',
  password: 'Sup3rSecret!',
  role: 'artist',
  username: 'signupflow',
  name: 'Signup Flow',
};

describe('E2E: signup → authenticated request', () => {
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

  it('completes the full signup-to-authenticated-request flow', async () => {
    // 1. Sign up with email + password.
    const signup = await request(app)
      .post('/api/auth/register-email')
      .send(signupPayload)
      .expect(201);

    expect(signup.body.success).toBe(true);
    expect(signup.body.token).toBeDefined();
    expect(signup.body.refreshToken).toBeDefined();

    const created = await AppDataSource.getRepository(User).findOneBy({
      email: signupPayload.email,
    });
    expect(created).toBeDefined();
    expect(created?.emailVerified).toBe(false);

    // 2. Verify the email address via the emailed token.
    const verify = await request(app).get('/api/auth/verify-email/verification-token').expect(200);

    expect(verify.body.success).toBe(true);
    const verified = await AppDataSource.getRepository(User).findOneBy({
      email: signupPayload.email,
    });
    expect(verified?.emailVerified).toBe(true);

    // 3. Log in and obtain a session token.
    const login = await request(app)
      .post('/api/auth/login-email')
      .send({ email: signupPayload.email, password: signupPayload.password })
      .expect(200);

    expect(login.body.success).toBe(true);
    expect(login.body.token).toBeDefined();

    // 4. Use that token against a protected endpoint.
    const profile = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(profile.body.success).toBe(true);
    expect(profile.body.data.email).toBe(signupPayload.email);
    expect(profile.body.data.username).toBe(signupPayload.username);
    expect(profile.body.data.emailVerified).toBe(true);
  });

  it('rejects unauthenticated, malformed, and expired tokens on protected routes', async () => {
    await request(app).post('/api/auth/register-email').send(signupPayload).expect(201);

    await request(app).get('/api/users/profile').expect(401);

    await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);

    const user = await AppDataSource.getRepository(User).findOneBy({
      email: signupPayload.email,
    });
    expect(user).toBeDefined();

    const expired = jwt.sign({ id: user!.id, role: 'artist' }, process.env.JWT_SECRET as string, {
      expiresIn: '-10s',
    });

    await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('issues a rotated token on refresh that authenticates, then revokes it on logout', async () => {
    // loginWithEmail does not issue a refresh token upstream; registration
    // does, so the refresh flow starts from the registration response.
    const signup = await request(app)
      .post('/api/auth/register-email')
      .send(signupPayload)
      .expect(201);

    expect(signup.body.refreshToken).toBeDefined();

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: signup.body.refreshToken })
      .expect(200);

    expect(refresh.body.token).toBeDefined();
    expect(refresh.body.refreshToken).not.toEqual(signup.body.refreshToken);

    // The rotated access token works on a protected endpoint.
    await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${refresh.body.token}`)
      .expect(200);

    // Logging out revokes the session for subsequent refresh attempts.
    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: refresh.body.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refresh.body.refreshToken })
      .expect(401);
  });
});
