import { Request, Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/SubscriptionService';
import { SubscriptionTier } from '../entities/Subscription';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

/**
 * Middleware to enforce tier-based access control.
 * Checks if the authenticated user has the required subscription tier.
 *
 * @param requiredTier - The minimum tier required to access the resource
 * @returns Express middleware function
 */
export const requireTier =
  (requiredTier: SubscriptionTier) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(
          req,
          res,
          AppError.authentication('Authentication required for this endpoint'),
        );
      }

      const subscriptionService = new SubscriptionService();
      const hasAccess = await subscriptionService.hasTierAccess(userId, requiredTier);

      if (!hasAccess) {
        return handleError(
          req,
          res,
          AppError.authorization(
            `This feature requires ${requiredTier} tier or higher. Please upgrade your subscription.`,
          ),
        );
      }

      next();
    } catch (error) {
      handleError(req, res, error);
    }
  };

/**
 * Utility function to check tier access in service/controller logic.
 * Use this when you need to check tier access without blocking the request.
 *
 * @param userId - The user's UUID
 * @param requiredTier - The minimum tier required
 * @returns Promise<boolean> - true if user has access
 */
export async function checkTierAccess(
  userId: string,
  requiredTier: SubscriptionTier,
): Promise<boolean> {
  const subscriptionService = new SubscriptionService();
  return await subscriptionService.hasTierAccess(userId, requiredTier);
}
