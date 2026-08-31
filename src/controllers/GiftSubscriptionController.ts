import { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { GiftSubscription, GiftStatus } from '../entities/GiftSubscription';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../entities/Subscription';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

/**
 * Controller for subscription gifting (Issue #414).
 *
 * Allows one user to gift a subscription tier to another user.
 * The recipient can accept, decline, or let the gift expire.
 */
export class GiftSubscriptionController {
  /**
   * Send a gift subscription to another user.
   * POST /api/subscriptions/gift
   */
  sendGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const senderId = (req as any).userId;
      const { recipientId, tier, durationDays, message } = req.body;

      if (!recipientId || !tier) {
        return handleError(req, res, AppError.badRequest('recipientId and tier are required'));
      }

      if (!Object.values(SubscriptionTier).includes(tier)) {
        return handleError(req, res, AppError.badRequest('Invalid subscription tier'));
      }

      if (senderId === recipientId) {
        return handleError(req, res, AppError.badRequest('Cannot gift a subscription to yourself'));
      }

      const repo = AppDataSource.getRepository(GiftSubscription);

      // Check for existing pending gift from this sender to this recipient
      const existing = await repo.findOne({
        where: { senderId, recipientId, status: GiftStatus.PENDING },
      });
      if (existing) {
        return handleError(
          req,
          res,
          AppError.conflict('A pending gift already exists for this recipient'),
        );
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Gifts expire after 7 days

      const gift = repo.create({
        senderId,
        recipientId,
        tier,
        durationDays: durationDays || null,
        message: message || null,
        expiresAt,
      });

      await repo.save(gift);
      res.status(201).json({ gift });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List gifts sent or received by the current user.
   * GET /api/subscriptions/gifts
   */
  listGifts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).userId;
      const repo = AppDataSource.getRepository(GiftSubscription);

      const gifts = await repo.find({
        where: [{ senderId: userId }, { recipientId: userId }],
        order: { createdAt: 'DESC' },
      });

      res.json({ gifts });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Accept a gift subscription.
   * POST /api/subscriptions/gift/:id/accept
   */
  acceptGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;
      const repo = AppDataSource.getRepository(GiftSubscription);

      const gift = await repo.findOneBy({ id });
      if (!gift) {
        return handleError(req, res, AppError.notFound('Gift not found'));
      }

      if (gift.recipientId !== userId) {
        return handleError(req, res, AppError.forbidden('Only the recipient can accept a gift'));
      }

      if (gift.status !== GiftStatus.PENDING) {
        return handleError(req, res, AppError.badRequest('Gift is no longer pending'));
      }

      if (gift.expiresAt && new Date() > gift.expiresAt) {
        gift.status = GiftStatus.EXPIRED;
        await repo.save(gift);
        return handleError(req, res, AppError.badRequest('Gift has expired'));
      }

      // Activate the subscription for the recipient
      const subRepo = AppDataSource.getRepository(Subscription);
      let subscription = await subRepo.findOneBy({ userId });

      if (subscription) {
        subscription.tier = gift.tier;
        subscription.status = SubscriptionStatus.ACTIVE;
        subscription.startDate = new Date();
        if (gift.durationDays) {
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + gift.durationDays);
          subscription.endDate = endDate;
        }
      } else {
        subscription = subRepo.create({
          userId,
          tier: gift.tier,
          status: SubscriptionStatus.ACTIVE,
          startDate: new Date(),
          endDate: gift.durationDays
            ? new Date(Date.now() + gift.durationDays * 86400000)
            : undefined,
        });
      }

      await subRepo.save(subscription);

      gift.status = GiftStatus.ACCEPTED;
      gift.redeemedAt = new Date();
      await repo.save(gift);

      res.json({ gift, subscription });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Decline a gift subscription.
   * POST /api/subscriptions/gift/:id/decline
   */
  declineGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;
      const repo = AppDataSource.getRepository(GiftSubscription);

      const gift = await repo.findOneBy({ id });
      if (!gift) {
        return handleError(req, res, AppError.notFound('Gift not found'));
      }

      if (gift.recipientId !== userId) {
        return handleError(req, res, AppError.forbidden('Only the recipient can decline a gift'));
      }

      if (gift.status !== GiftStatus.PENDING) {
        return handleError(req, res, AppError.badRequest('Gift is no longer pending'));
      }

      gift.status = GiftStatus.DECLINED;
      await repo.save(gift);

      res.json({ gift });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
