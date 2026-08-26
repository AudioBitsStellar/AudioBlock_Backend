process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import AppDataSource from '../../src/config/db';
import app from '../../src/app';
import { User } from '../../src/entities/User';

const redisStore = new Map<string, string>();

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
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

describe('Auth integration tests', () => {
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

  const userPayload = {
    email: 'test@example.com',
    password: 'password123',
    role: 'artist',
    username: 'testuser',
    name: 'Test User',
  };

  it('successful registration creates user and returns tokens', async () => {
    const res = await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    const saved = await AppDataSource.getRepository(User).findOneBy({ email: userPayload.email });
    expect(saved).toBeDefined();
    expect(saved?.email).toBe(userPayload.email);
  });

  it('duplicate email returns 409', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const res = await request(app).post('/api/auth/register-email').send(userPayload).expect(409);
    expect(res.body.message).toContain('User already exists');
  });

  it('login with valid credentials returns tokens', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const res = await request(app)
      .post('/api/auth/login-email')
      .send({ email: userPayload.email, password: userPayload.password })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('login with invalid credentials returns 401', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const res = await request(app)
      .post('/api/auth/login-email')
      .send({ email: userPayload.email, password: 'wrong-password' })
      .expect(401);

    expect(res.body.message).toContain('Invalid email or password');
  });

  it('expired token returns 401', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const user = await AppDataSource.getRepository(User).findOneBy({ email: userPayload.email });
    expect(user).toBeDefined();

    const expiredToken = jwt.sign(
      { id: user!.id, role: 'artist' },
      process.env.JWT_SECRET as string,
      {
        expiresIn: '-10s',
      },
    );

    const res = await request(app)
      .get('/api/user/')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(res.body.message || res.body.error).toBeDefined();
  });

  it('refresh token produces new token pair', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const login = await request(app)
      .post('/api/auth/login-email')
      .send({ email: userPayload.email, password: userPayload.password })
      .expect(200);

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    expect(refreshRes.body.token).toBeDefined();
    expect(refreshRes.body.refreshToken).toBeDefined();
    expect(refreshRes.body.refreshToken).not.toEqual(login.body.refreshToken);
  });

  it('logout invalidates refresh tokens', async () => {
    await request(app).post('/api/auth/register-email').send(userPayload).expect(201);

    const login = await request(app)
      .post('/api/auth/login-email')
      .send({ email: userPayload.email, password: userPayload.password })
      .expect(200);

    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });
});
