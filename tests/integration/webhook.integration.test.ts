process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import AppDataSource from '../../src/config/db';
import app from '../../src/app';
import { User, UserRole } from '../../src/entities/User';
import { WebhookSubscription } from '../../src/entities/WebhookSubscription';
import { WebhookService } from '../../src/services/WebhookService';

describe('Webhook Handlers Integration Tests (Issue #623)', () => {
  let authToken: string;
  let testUser: User;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.synchronize(true);

    const userRepo = AppDataSource.getRepository(User);
    testUser = userRepo.create({
      email: 'webhook-tester@audioblock.com',
      username: 'webhooktester',
      role: UserRole.ARTIST,
      walletAddress: 'GAWEBHOOKTESTERADDRESS12345678901234567890',
      isEmailVerified: true,
    });
    await userRepo.save(testUser);

    authToken = jwt.sign(
      { id: testUser.id, role: testUser.role, email: testUser.email },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    const subRepo = AppDataSource.getRepository(WebhookSubscription);
    await subRepo.clear();
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe('POST /api/webhooks/register', () => {
    it('registers a new webhook subscription for authenticated user', async () => {
      const payload = {
        endpoint: 'https://thirdparty.example.com/api/webhook',
        eventTypes: ['song.minted', 'sale.completed'],
      };

      const res = await request(app)
        .post('/api/webhooks/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.endpoint).toBe(payload.endpoint);
      expect(res.body.data.eventTypes).toEqual(payload.eventTypes);
      expect(res.body.data.secret).toBeDefined();
      expect(res.body.data.userId).toBe(testUser.id);

      const saved = await AppDataSource.getRepository(WebhookSubscription).findOneBy({
        id: res.body.data.id,
      });
      expect(saved).toBeDefined();
      expect(saved?.endpoint).toBe(payload.endpoint);
    });

    it('rejects registration when unauthenticated with 401', async () => {
      const payload = {
        endpoint: 'https://thirdparty.example.com/api/webhook',
        eventTypes: ['song.minted'],
      };

      await request(app)
        .post('/api/webhooks/register')
        .send(payload)
        .expect(401);
    });

    it('rejects registration with invalid URL endpoint', async () => {
      const payload = {
        endpoint: 'invalid-url-string',
        eventTypes: ['song.minted'],
      };

      const res = await request(app)
        .post('/api/webhooks/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload)
        .expect(400);

      expect(res.body.message || res.body.error).toBeDefined();
    });
  });

  describe('GET /api/webhooks', () => {
    it('lists active webhook subscriptions for the authenticated user', async () => {
      const subRepo = AppDataSource.getRepository(WebhookSubscription);
      const sub1 = subRepo.create({
        userId: testUser.id,
        endpoint: 'https://app.example.com/hook1',
        secret: 'sec1',
        eventTypes: ['song.minted'],
        isActive: true,
      });
      const sub2 = subRepo.create({
        userId: testUser.id,
        endpoint: 'https://app.example.com/hook2',
        secret: 'sec2',
        eventTypes: ['sale.completed'],
        isActive: true,
      });
      await subRepo.save([sub1, sub2]);

      const res = await request(app)
        .get('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].userId).toBe(testUser.id);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('deletes an existing webhook subscription', async () => {
      const subRepo = AppDataSource.getRepository(WebhookSubscription);
      const sub = await subRepo.save(
        subRepo.create({
          userId: testUser.id,
          endpoint: 'https://app.example.com/hook-to-delete',
          secret: 'secret-to-delete',
          eventTypes: ['*'],
          isActive: true,
        }),
      );

      const res = await request(app)
        .delete(`/api/webhooks/${sub.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deleted');

      const found = await subRepo.findOneBy({ id: sub.id });
      expect(found).toBeNull();
    });
  });

  describe('Webhook delivery & HMAC signing integration', () => {
    it('signs payloads with HMAC-SHA256 and delivers with correct signature header', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const webhookService = new WebhookService(fetchMock as any);

      const payload = {
        eventId: 'evt-12345',
        eventType: 'song.minted',
        timestamp: new Date().toISOString(),
        songId: 'song-test-1',
      };
      const secret = 'webhook-test-secret-key-123';

      await webhookService.deliver('https://subscriber.example.com/events', payload, secret);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://subscriber.example.com/events');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const signature = options.headers['X-Webhook-Signature'];
      expect(signature).toBeDefined();
      expect(webhookService.verifySignature(payload, signature, secret)).toBe(true);
    });
  });
});
