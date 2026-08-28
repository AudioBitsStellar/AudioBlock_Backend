import { Request, Response } from 'express';
import { SubscriptionService } from '../services/SubscriptionService';
import { SubscriptionTier } from '../entities/Subscription';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';

/**
 * Controller for subscription-related endpoints.
 * Handles subscription management for authenticated users.
 */
export class SubscriptionController {
  private subscriptionService: SubscriptionService;

  constructor() {
    this.subscriptionService = new SubscriptionService();
  }

  /**
   * Get the current user's subscription.
   * GET /api/users/me/subscription
   *
   * @param req - Express request with authenticated user
   * @param res - Express response
   */
  getMySubscription = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, { message: 'User not authenticated', statusCode: 401 });
      }

      const subscription = await this.subscriptionService.getUserSubscription(userId);

      if (!subscription) {
        res.status(HTTP_STATUS.OK).json({
          subscription: null,
          tier: SubscriptionTier.FREE,
          message: 'No active subscription - user is on FREE tier',
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json({
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Create or upgrade a subscription.
   * POST /api/subscriptions
   *
   * @param req - Express request with tier and optional endDate in body
   * @param res - Express response
   */
  createOrUpgradeSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, { message: 'User not authenticated', statusCode: 401 });
      }

      const { tier, endDate } = req.body;

      const subscription = await this.subscriptionService.createOrUpgradeSubscription(
        userId,
        tier,
        endDate ? new Date(endDate) : undefined,
      );

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Subscription created/upgraded successfully',
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Cancel the current user's subscription.
   * DELETE /api/subscriptions
   *
   * @param req - Express request with authenticated user
   * @param res - Express response
   */
  cancelSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, { message: 'User not authenticated', statusCode: 401 });
      }

      const subscription = await this.subscriptionService.cancelSubscription(userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Subscription cancelled successfully. Access will remain until end date.',
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Create a trial subscription.
   * POST /api/subscriptions/trial
   *
   * @param req - Express request with tier and optional trialDurationDays in body
   * @param res - Express response
   */
  createTrialSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, { message: 'User not authenticated', statusCode: 401 });
      }

      const { tier, trialDurationDays } = req.body;

      const subscription = await this.subscriptionService.createTrialSubscription(
        userId,
        tier,
        trialDurationDays,
      );

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Trial subscription created successfully',
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          isTrial: subscription.isTrial,
          trialDurationDays: subscription.trialDurationDays,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Convert a trial subscription to a paid subscription.
   * POST /api/subscriptions/trial/convert
   *
   * @param req - Express request with endDate in body
   * @param res - Express response
   */
  convertTrialToPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, { message: 'User not authenticated', statusCode: 401 });
      }

      const { endDate } = req.body;

      if (!endDate) {
        return handleError(req, res, { message: 'endDate is required', statusCode: 400 });
      }

      const subscription = await this.subscriptionService.convertTrialToPaid(
        userId,
        new Date(endDate),
      );

      res.status(HTTP_STATUS.OK).json({
        message: 'Trial subscription converted to paid successfully',
        subscription: {
          id: subscription.id,
          tier: subscription.tier,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          isTrial: subscription.isTrial,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
