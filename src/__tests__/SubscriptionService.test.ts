/* eslint-disable max-lines-per-function */
import { Repository } from 'typeorm';
import { SubscriptionService } from '../services/SubscriptionService';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../entities/Subscription';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

describe('SubscriptionService', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionRepo: jest.Mocked<Repository<Subscription>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSubscriptionRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Subscription>>;

    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockSubscriptionRepo);

    subscriptionService = new SubscriptionService();
  });

  describe('getUserSubscription', () => {
    const userId = 'user-123';

    it('should return active subscription for user', async () => {
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.ARTIST_PRO,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);

      const result = await subscriptionService.getUserSubscription(userId);

      expect(mockSubscriptionRepo.findOne).toHaveBeenCalledWith({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
        },
        order: {
          createdAt: 'DESC',
        },
      });
      expect(result).toEqual(mockSubscription);
    });

    it('should return null if no active subscription found', async () => {
      mockSubscriptionRepo.findOne.mockResolvedValue(null);

      const result = await subscriptionService.getUserSubscription(userId);

      expect(result).toBeNull();
    });

    it('should mark expired subscriptions and return null', async () => {
      const expiredDate = new Date('2025-01-01');
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.ARTIST_PRO,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2024-01-01'),
        endDate: expiredDate,
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);
      mockSubscriptionRepo.save.mockResolvedValue(mockSubscription as Subscription);

      const result = await subscriptionService.getUserSubscription(userId);

      expect(mockSubscription.status).toBe(SubscriptionStatus.EXPIRED);
      expect(mockSubscriptionRepo.save).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should throw error for missing userId', async () => {
      await expect(subscriptionService.getUserSubscription('')).rejects.toThrow(AppError);
    });
  });

  describe('createOrUpgradeSubscription', () => {
    const userId = 'user-123';

    it('should create new subscription for user without existing subscription', async () => {
      const tier = SubscriptionTier.ARTIST_PRO;
      const endDate = new Date('2027-01-01');

      mockSubscriptionRepo.findOne.mockResolvedValue(null);
      mockSubscriptionRepo.create.mockReturnValue({
        userId,
        tier,
        status: SubscriptionStatus.ACTIVE,
        startDate: expect.any(Date),
        endDate,
      } as Subscription);
      mockSubscriptionRepo.save.mockResolvedValue({
        id: 'sub-123',
        userId,
        tier,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        endDate,
      } as Subscription);

      const result = await subscriptionService.createOrUpgradeSubscription(userId, tier, endDate);

      expect(mockSubscriptionRepo.create).toHaveBeenCalled();
      expect(mockSubscriptionRepo.save).toHaveBeenCalled();
      expect(result.tier).toBe(tier);
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('should upgrade existing subscription', async () => {
      const existingSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.FREE,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
      };

      const newTier = SubscriptionTier.LABEL;

      mockSubscriptionRepo.findOne.mockResolvedValue(existingSubscription as Subscription);
      mockSubscriptionRepo.save.mockResolvedValue({
        ...existingSubscription,
        tier: newTier,
      } as Subscription);

      const result = await subscriptionService.createOrUpgradeSubscription(userId, newTier);

      expect(result.tier).toBe(newTier);
      expect(mockSubscriptionRepo.save).toHaveBeenCalled();
    });

    it('should throw error for invalid tier', async () => {
      mockSubscriptionRepo.findOne.mockResolvedValue(null);

      await expect(
        subscriptionService.createOrUpgradeSubscription(userId, 'invalid' as SubscriptionTier),
      ).rejects.toThrow(AppError);
    });

    it('should throw error for missing userId', async () => {
      await expect(
        subscriptionService.createOrUpgradeSubscription('', SubscriptionTier.ARTIST_PRO),
      ).rejects.toThrow(AppError);
    });
  });

  describe('cancelSubscription', () => {
    const userId = 'user-123';

    it('should cancel active subscription', async () => {
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.ARTIST_PRO,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);
      mockSubscriptionRepo.save.mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionStatus.CANCELLED,
      } as Subscription);

      const result = await subscriptionService.cancelSubscription(userId);

      expect(result.status).toBe(SubscriptionStatus.CANCELLED);
      expect(mockSubscriptionRepo.save).toHaveBeenCalled();
    });

    it('should throw error if no active subscription found', async () => {
      mockSubscriptionRepo.findOne.mockResolvedValue(null);

      await expect(subscriptionService.cancelSubscription(userId)).rejects.toThrow(AppError);
      await expect(subscriptionService.cancelSubscription(userId)).rejects.toThrow(
        /No active subscription/,
      );
    });
  });

  describe('hasTierAccess', () => {
    const userId = 'user-123';

    it('should return true for FREE tier when user has no subscription', async () => {
      mockSubscriptionRepo.findOne.mockResolvedValue(null);

      const result = await subscriptionService.hasTierAccess(userId, SubscriptionTier.FREE);

      expect(result).toBe(true);
    });

    it('should return false for ARTIST_PRO when user has no subscription', async () => {
      mockSubscriptionRepo.findOne.mockResolvedValue(null);

      const result = await subscriptionService.hasTierAccess(userId, SubscriptionTier.ARTIST_PRO);

      expect(result).toBe(false);
    });

    it('should return true when user has exact required tier', async () => {
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.ARTIST_PRO,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);

      const result = await subscriptionService.hasTierAccess(userId, SubscriptionTier.ARTIST_PRO);

      expect(result).toBe(true);
    });

    it('should return true when user has higher tier than required', async () => {
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.LABEL,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);

      const result = await subscriptionService.hasTierAccess(userId, SubscriptionTier.ARTIST_PRO);

      expect(result).toBe(true);
    });

    it('should return false when user has lower tier than required', async () => {
      const mockSubscription: Partial<Subscription> = {
        id: 'sub-123',
        userId,
        tier: SubscriptionTier.ARTIST_PRO,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
      };

      mockSubscriptionRepo.findOne.mockResolvedValue(mockSubscription as Subscription);

      const result = await subscriptionService.hasTierAccess(userId, SubscriptionTier.LABEL);

      expect(result).toBe(false);
    });
  });
});
