/* eslint-disable max-lines-per-function */
import { Request, Response, NextFunction } from 'express';
import { requireTier, checkTierAccess } from '../subscriptionMiddleware';
import { SubscriptionTier } from '../../entities/Subscription';
import { SubscriptionService } from '../../services/SubscriptionService';

jest.mock('../../services/SubscriptionService');

describe('Subscription Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockSubscriptionService: jest.Mocked<SubscriptionService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    nextFunction = jest.fn();

    mockSubscriptionService = {
      hasTierAccess: jest.fn(),
    } as any;

    (SubscriptionService as jest.Mock).mockImplementation(() => mockSubscriptionService);
  });

  describe('requireTier', () => {
    it('should allow access when user has required tier', async () => {
      (mockRequest as any).user = {
        id: 'user-123',
        role: 'artist',
      };

      mockSubscriptionService.hasTierAccess.mockResolvedValue(true);

      const middleware = requireTier(SubscriptionTier.ARTIST_PRO);
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockSubscriptionService.hasTierAccess).toHaveBeenCalledWith(
        'user-123',
        SubscriptionTier.ARTIST_PRO,
      );
      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject access when user lacks required tier (returns 403)', async () => {
      (mockRequest as any).user = {
        id: 'user-123',
        role: 'artist',
      };

      mockSubscriptionService.hasTierAccess.mockResolvedValue(false);

      const middleware = requireTier(SubscriptionTier.LABEL);
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockSubscriptionService.hasTierAccess).toHaveBeenCalledWith(
        'user-123',
        SubscriptionTier.LABEL,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject access when user is not authenticated', async () => {
      (mockRequest as any).user = undefined;

      const middleware = requireTier(SubscriptionTier.ARTIST_PRO);
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockSubscriptionService.hasTierAccess).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (mockRequest as any).user = {
        id: 'user-123',
        role: 'artist',
      };

      mockSubscriptionService.hasTierAccess.mockRejectedValue(new Error('Database error'));

      const middleware = requireTier(SubscriptionTier.ARTIST_PRO);
      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalled();
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('checkTierAccess', () => {
    it('should return true when user has tier access', async () => {
      mockSubscriptionService.hasTierAccess.mockResolvedValue(true);

      const result = await checkTierAccess('user-123', SubscriptionTier.ARTIST_PRO);

      expect(result).toBe(true);
      expect(mockSubscriptionService.hasTierAccess).toHaveBeenCalledWith(
        'user-123',
        SubscriptionTier.ARTIST_PRO,
      );
    });

    it('should return false when user lacks tier access', async () => {
      mockSubscriptionService.hasTierAccess.mockResolvedValue(false);

      const result = await checkTierAccess('user-123', SubscriptionTier.LABEL);

      expect(result).toBe(false);
      expect(mockSubscriptionService.hasTierAccess).toHaveBeenCalledWith(
        'user-123',
        SubscriptionTier.LABEL,
      );
    });
  });
});
