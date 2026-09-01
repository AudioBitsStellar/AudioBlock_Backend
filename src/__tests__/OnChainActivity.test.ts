import 'reflect-metadata';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { ActivityService } from '../services/ActivityService';
import { ActivityController } from '../controllers/ActivityController';
import activityRoutes from '../routes/activityRoutes';
import { IndexedEvent } from '../entities/IndexedEvent';
import AppDataSource from '../config/db';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

describe('On-Chain Activity — GET /api/activity/onchain', () => {
  let mockQueryBuilder: any;
  let mockIndexedEventRepo: any;
  let activityService: ActivityService;
  let testApp: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockIndexedEventRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === IndexedEvent || entity?.name === 'IndexedEvent') {
        return mockIndexedEventRepo;
      }
      return {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
    });

    activityService = new ActivityService();

    testApp = express();
    testApp.use(express.json());
    testApp.use('/api/activity', activityRoutes);
  });

  describe('ActivityService.getOnChainActivity', () => {
    it('returns default pagination (page 1, limit 20) and orders by createdAt DESC', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          contractType: 'marketplace',
          eventType: 'sale',
          address: 'GB1234567890',
          txHash: '0xabc123',
          ledger: 1000,
          data: { price: '500' },
          createdAt: new Date('2026-08-31T00:00:00Z'),
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockEvents, 1]);

      const result = await activityService.getOnChainActivity();

      expect(mockIndexedEventRepo.createQueryBuilder).toHaveBeenCalledWith('event');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('event.createdAt', 'DESC');
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({
        data: mockEvents,
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      });
    });

    it('applies custom pagination correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 45]);

      const result = await activityService.getOnChainActivity({ page: 3, limit: 10 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(20);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    it('clamps page to minimum 1 and limit to maximum 100', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await activityService.getOnChainActivity({ page: -5, limit: 250 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(100);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(100);
    });

    it('filters by contractType', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await activityService.getOnChainActivity({ contractType: 'nft' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.contractType = :contractType', {
        contractType: 'nft',
      });
    });

    it('filters by eventType', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await activityService.getOnChainActivity({ eventType: 'mint' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.eventType = :eventType', {
        eventType: 'mint',
      });
    });

    it('filters by address', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const targetAddress = 'GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      await activityService.getOnChainActivity({ address: targetAddress });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.address = :address', {
        address: targetAddress,
      });
    });

    it('combines contractType, eventType, and address filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const targetAddress = 'GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      await activityService.getOnChainActivity({
        contractType: 'royalty',
        eventType: 'payout',
        address: targetAddress,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.contractType = :contractType', {
        contractType: 'royalty',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.eventType = :eventType', {
        eventType: 'payout',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('event.address = :address', {
        address: targetAddress,
      });
    });

    it('returns empty data and totalPages 0 when no events match', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await activityService.getOnChainActivity({
        contractType: 'non_existent',
      });

      expect(result).toEqual({
        data: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });
    });
  });

  describe('ActivityController.getOnChainActivity', () => {
    it('returns 200 with data and pagination on success', async () => {
      const mockEvents = [
        {
          id: 'evt-100',
          contractType: 'catalog',
          eventType: 'song_minted',
          address: 'GBCATALOG123',
          txHash: '0xhash100',
          ledger: 5000,
          data: { songId: 'song-1' },
          createdAt: new Date(),
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockEvents, 1]);

      const req = {
        query: {
          contractType: 'catalog',
          eventType: 'song_minted',
          address: 'GBCATALOG123',
          page: '2',
          limit: '10',
        },
      } as unknown as Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      await ActivityController.getOnChainActivity(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockEvents,
        pagination: {
          page: 2,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      });
    });

    it('handles errors gracefully via handleError', async () => {
      mockQueryBuilder.getManyAndCount.mockRejectedValue(new Error('Database failure'));

      const req = {
        query: {},
      } as unknown as Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      await ActivityController.getOnChainActivity(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        }),
      );
    });
  });

  describe('HTTP GET /api/activity/onchain route', () => {
    it('responds to GET /api/activity/onchain with 200 OK', async () => {
      const mockEvents = [
        {
          id: 'evt-200',
          contractType: 'nft',
          eventType: 'transfer',
          address: 'GBADDR1',
          txHash: '0xtx1',
          ledger: 100,
          createdAt: new Date('2026-08-31T08:00:00.000Z'),
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockEvents, 1]);

      const response = await request(testApp).get('/api/activity/onchain').query({
        contractType: 'nft',
        eventType: 'transfer',
        address: 'GBADDR1',
        page: 1,
        limit: 10,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });
  });
});
