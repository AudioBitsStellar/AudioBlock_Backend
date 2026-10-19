import 'reflect-metadata';
import request from 'supertest';
import express, { Express } from 'express';
import { WebhookService } from '../services/WebhookService';
import { WebhookDelivery, WebhookDeliveryStatus } from '../entities/WebhookDelivery';
import { WebhookController } from '../controllers/WebhookController';

// Mock DB, logger, and authMiddleware
jest.mock('../config/db', () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

jest.mock('../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../middlewares/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    next();
  },
}));

import AppDataSource from '../config/db';
import webhookRoutes from '../routes/webhookRoutes';

describe('Webhook Delivery Tracking & Redeliver (Issue #824)', () => {
  let app: Express;
  let authUser: any = null;

  const mockSubscription: any = {
    id: 'sub-uuid-1',
    userId: 'user-uuid-1',
    endpoint: 'https://example.com/webhook',
    secret: 'test-secret',
    isActive: true,
    consecutiveFailures: 0,
    eventTypes: ['song.minted'],
    createdAt: new Date(),
  };

  const mockDelivery: any = {
    id: 'del-uuid-1',
    subscriptionId: 'sub-uuid-1',
    eventId: 'evt-uuid-1',
    eventType: 'song.minted',
    attempt: 1,
    status: WebhookDeliveryStatus.SUCCEEDED,
    responseStatus: 200,
    durationMs: 45,
    error: null,
    payload: { eventId: 'evt-uuid-1', eventType: 'song.minted', songId: 'song-1' },
    createdAt: new Date(),
  };

  let mockDeliveryRepo: any;
  let mockSubRepo: any;
  let mockNotificationService: any;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    authUser = { id: 'user-uuid-1', role: 'artist' };
    fetchMock = jest.fn();

    mockDeliveryRepo = {
      save: jest.fn(async (d) => ({ ...d, id: d.id || 'del-uuid-new', createdAt: new Date() })),
      findAndCount: jest.fn(async () => [[mockDelivery], 1]),
      findOne: jest.fn(async ({ where }) => {
        if (where?.id === 'del-uuid-1' && where?.subscriptionId === 'sub-uuid-1') {
          return { ...mockDelivery };
        }
        return null;
      }),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              execute: jest.fn(async () => ({ affected: 5 })),
            })),
          })),
        })),
      })),
    };

    mockSubRepo = {
      findOne: jest.fn(async ({ where }) => {
        if (where?.id === 'sub-uuid-1') return { ...mockSubscription };
        return null;
      }),
      save: jest.fn(async (s) => s),
      find: jest.fn(async () => [{ ...mockSubscription }]),
    };

    mockNotificationService = {
      create: jest.fn(async (n) => n),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((target: any) => {
      const name = target?.name;
      if (name === 'WebhookDelivery') return mockDeliveryRepo;
      if (name === 'WebhookSubscription') return mockSubRepo;
      return {};
    });

    const svc = new WebhookService(
      fetchMock,
      mockSubRepo,
      mockDeliveryRepo,
      mockNotificationService,
    );
    WebhookController.setWebhookService(svc);

    // Setup express app
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (authUser) {
        (req as any).user = authUser;
      }
      next();
    });
    app.use('/api/webhooks', webhookRoutes);
  });

  describe('WebhookService Unit Logic', () => {
    it('records delivery attempt row upon successful delivery', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

      const svc = new WebhookService(
        fetchMock,
        mockSubRepo,
        mockDeliveryRepo,
        mockNotificationService,
      );

      const payload = {
        eventId: 'evt-test-1',
        eventType: 'song.minted',
        timestamp: new Date().toISOString(),
      };

      await svc.deliver('https://example.com/webhook', payload, 'secret', 'sub-uuid-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-uuid-1',
          eventId: 'evt-test-1',
          eventType: 'song.minted',
          attempt: 1,
          status: WebhookDeliveryStatus.SUCCEEDED,
          responseStatus: 200,
        }),
      );
    });

    it('records failed attempt rows and auto-disables subscription after N consecutive failed events', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

      // Subscription already has 4 consecutive failures
      mockSubscription.consecutiveFailures = 4;
      mockSubscription.isActive = true;

      const svc = new WebhookService(
        fetchMock,
        mockSubRepo,
        mockDeliveryRepo,
        mockNotificationService,
      );

      const payload = {
        eventId: 'evt-fail-1',
        eventType: 'song.minted',
        timestamp: new Date().toISOString(),
      };

      await expect(
        svc.deliver('https://example.com/webhook', payload, 'secret', 'sub-uuid-1'),
      ).rejects.toThrow('Webhook delivery failed after 3 attempts');

      // 3 attempts recorded in delivery table
      expect(mockDeliveryRepo.save).toHaveBeenCalledTimes(3);

      // Subscription consecutive failures incremented to 5, isActive set to false
      expect(mockSubRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub-uuid-1',
          consecutiveFailures: 5,
          isActive: false,
        }),
      );

      // Owner notified via NotificationService
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          type: 'system',
          title: 'Webhook subscription disabled',
        }),
      );
    });

    it('cleans up old delivery rows older than 30 days', async () => {
      const svc = new WebhookService(
        fetchMock,
        mockSubRepo,
        mockDeliveryRepo,
        mockNotificationService,
      );

      const deleted = await svc.cleanupOldDeliveries(30);
      expect(deleted).toBe(5);
      expect(mockDeliveryRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    it('returns paginated delivery records for subscription owner', async () => {
      const res = await request(app)
        .get('/api/webhooks/sub-uuid-1/deliveries')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('del-uuid-1');
      expect(res.body.pagination.total).toBe(1);
    });

    it('returns 403 when user is not the subscription owner', async () => {
      authUser = { id: 'other-user-uuid', role: 'artist' };

      const res = await request(app)
        .get('/api/webhooks/sub-uuid-1/deliveries')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('rejects unauthenticated requests with 401', async () => {
      authUser = null;

      const res = await request(app)
        .get('/api/webhooks/sub-uuid-1/deliveries')
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/webhooks/:id/deliveries/:deliveryId/redeliver', () => {
    it('triggers redelivery of previous delivery for subscription owner', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      const res = await request(app)
        .post('/api/webhooks/sub-uuid-1/deliveries/del-uuid-1/redeliver')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Webhook redelivered successfully');
    });

    it('returns 404 when delivery record does not exist', async () => {
      const res = await request(app)
        .post('/api/webhooks/sub-uuid-1/deliveries/nonexistent-del/redeliver')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not found');
    });
  });
});
