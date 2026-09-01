import express from 'express';
import { requireApiKey } from '../apiKeyMiddleware';
import { ApiKeyService } from '../../services/ApiKeyService';
import AppDataSource from '../../config/db';
import { User, UserRole } from '../../entities/User';

jest.mock('../../config/redis', () => {
  const store = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      pipeline: () => {
        let count = 0;
        return {
          zremrangebyscore: () => {},
          zadd: () => {},
          zcard: () => {
            count++;
            return Promise.resolve([null, count]);
          },
          expire: () => {},
          exec: () =>
            Promise.resolve([
              [null, 0],
              [null, 1],
              [null, 5],
              [null, 1],
            ]),
        };
      },
    },
  };
});

describe('API Key Rate Limit Tiers', () => {
  const app = express();
  app.get('/test-key', requireApiKey, (req, res) => {
    res.json({ success: true, tier: (req as any).apiKey.rateLimitTier });
  });

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.synchronize(true);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it('allows different tiers to be created and evaluated', async () => {
    const userRepo = AppDataSource.getRepository(User);
    const user = userRepo.create({
      email: 'tier@example.com',
      username: 'tieruser',
      passwordHash: 'hash',
      role: UserRole.ADMIN,
    });
    await userRepo.save(user);

    const service = new ApiKeyService();
    const standardKey = await service.createApiKey(user.id, 'Standard Key', [], [], 'standard');
    const highKey = await service.createApiKey(user.id, 'High Key', [], [], 'high');

    expect(standardKey.rateLimitTier).toBe('standard');
    expect(highKey.rateLimitTier).toBe('high');
  });
});
