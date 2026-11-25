import { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { GiftSubscription, GiftStatus } from '../entities/GiftSubscription';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../entities/Subscription';
import { NotificationService } from '../services/NotificationService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const notificationService = new NotificationService();

function currentUserId(req: Request): string | undefined {
  return (req as any).user?.id as string | undefined;
}

function giftExpiryDays(): number {
  const raw = Number(process.env.GIFT_SUBSCRIPTION_EXPIRY_DAYS ?? 7);
  return Number.isInteger(raw) && raw > 0 ? raw : 7;
}

export class GiftSubscriptionController {
  sendGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const senderId = currentUserId(req);
      if (!senderId) return handleError(req, res, AppError.authentication('Unauthorized'));

      const { recipientId, tier, durationDays, message } = req.body;
      if (!recipientId || !tier) {
        return handleError(req, res, AppError.validation('recipientId and tier are required'));
      }
      if (!Object.values(SubscriptionTier).includes(tier)) {
        return handleError(req, res, AppError.validation('Invalid subscription tier'));
      }
      if (senderId === recipientId) {
        return handleError(req, res, AppError.validation('Cannot gift a subscription to yourself'));
      }
      if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays <= 0)) {
        return handleError(req, res, AppError.validation('durationDays must be a positive integer'));
      }

      const repo = AppDataSource.getRepository(GiftSubscription);
      const existing = await repo.findOne({
        where: { senderId, recipientId, status: GiftStatus.PENDING },
      });
      if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) {
        return handleError(req, res, AppError.conflict('A pending gift already exists for this recipient'));
      }

      const expiresAt = new Date(Date.now() + giftExpiryDays() * 86400000);
      const gift = await repo.save(repo.create({
        senderId,
        recipientId,
        tier,
        durationDays: durationDays || null,
        message: message || null,
        expiresAt,
      }));

      await notificationService.create({
        userId: recipientId,
        type: 'system',
        title: 'You received a subscription gift',
        message: 'A subscription gift is waiting for you.',
        data: { giftId: gift.id, tier: gift.tier, expiresAt: gift.expiresAt },
      });

      res.status(201).json({ gift });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  listGifts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = currentUserId(req);
      if (!userId) return handleError(req, res, AppError.authentication('Unauthorized'));
      const repo = AppDataSource.getRepository(GiftSubscription);
      const gifts = await repo.find({
        where: [{ senderId: userId }, { recipientId: userId }],
        order: { createdAt: 'DESC' },
      });

      const now = new Date();
      const expired = gifts.filter(
        (gift) => gift.status === GiftStatus.PENDING && gift.expiresAt && gift.expiresAt <= now,
      );
      for (const gift of expired) gift.status = GiftStatus.EXPIRED;
      if (expired.length) await repo.save(expired);

      res.json({ gifts });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  acceptGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = currentUserId(req);
      if (!userId) return handleError(req, res, AppError.authentication('Unauthorized'));
      const id = req.params.id as string;

      const result = await AppDataSource.transaction(async (manager) => {
        const giftRepo = manager.getRepository(GiftSubscription);
        const subRepo = manager.getRepository(Subscription);
        const gift = await giftRepo.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!gift) throw AppError.notFound('Gift not found');
        if (gift.recipientId !== userId) {
          throw AppError.authorization('Only the recipient can accept a gift');
        }
        if (gift.status !== GiftStatus.PENDING) {
          throw AppError.conflict('Gift is no longer pending');
        }
        if (gift.expiresAt && gift.expiresAt <= new Date()) {
          gift.status = GiftStatus.EXPIRED;
          await giftRepo.save(gift);
          return { expired: true as const };
        }

        let subscription = await subRepo.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });
        const now = new Date();
        const durationMs = gift.durationDays ? gift.durationDays * 86400000 : 0;

        if (subscription) {
          subscription.tier = gift.tier;
          subscription.status = SubscriptionStatus.ACTIVE;
          if (durationMs) {
            const base = subscription.endDate && subscription.endDate > now ? subscription.endDate : now;
            subscription.endDate = new Date(base.getTime() + durationMs);
          }
        } else {
          subscription = subRepo.create({
            userId,
            tier: gift.tier,
            status: SubscriptionStatus.ACTIVE,
            startDate: now,
            endDate: durationMs ? new Date(now.getTime() + durationMs) : undefined,
          });
        }
        subscription = await subRepo.save(subscription);

        gift.status = GiftStatus.ACCEPTED;
        gift.redeemedAt = now;
        await giftRepo.save(gift);
        return { expired: false as const, gift, subscription };
      });

      if (result.expired) {
        return handleError(req, res, AppError.validation('Gift has expired'));
      }
      res.json({ gift: result.gift, subscription: result.subscription });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  declineGift = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = currentUserId(req);
      if (!userId) return handleError(req, res, AppError.authentication('Unauthorized'));
      const id = req.params.id as string;
      const repo = AppDataSource.getRepository(GiftSubscription);
      const gift = await repo.findOneBy({ id });
      if (!gift) return handleError(req, res, AppError.notFound('Gift not found'));
      if (gift.recipientId !== userId) {
        return handleError(req, res, AppError.authorization('Only the recipient can decline a gift'));
      }
      if (gift.status !== GiftStatus.PENDING) {
        return handleError(req, res, AppError.conflict('Gift is no longer pending'));
      }
      if (gift.expiresAt && gift.expiresAt <= new Date()) {
        gift.status = GiftStatus.EXPIRED;
        await repo.save(gift);
        return handleError(req, res, AppError.validation('Gift has expired'));
      }

      gift.status = GiftStatus.DECLINED;
      await repo.save(gift);
      res.json({ gift });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
