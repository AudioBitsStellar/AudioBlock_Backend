import { Request, Response } from 'express';
import { WebhookService } from '../services/WebhookService';
import { handleError } from '../utils/helpers';
import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import logger from '../config/logger';

const webhookService = new WebhookService();
const userRepo: Repository<User> = AppDataSource.getRepository(User);

export class WebhookController {
  static register = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const { endpoint, eventTypes, secret } = req.body;
      if (!endpoint)
        return res.status(400).json({ success: false, message: 'endpoint is required' });

      const subscription = await webhookService.registerSubscription(
        userId,
        endpoint,
        eventTypes,
        secret,
      );
      return res.status(201).json({ success: true, data: subscription });
    } catch (error) {
      handleError(res, error);
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const subs = await webhookService.listSubscriptions(userId);
      return res.status(200).json({ success: true, data: subs });
    } catch (error) {
      handleError(res, error);
    }
  };

  static remove = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const id = req.params.id as string;
      await webhookService.deleteSubscription(userId, id);
      return res.status(200).json({ success: true, message: 'Webhook subscription deleted' });
    } catch (error) {
      handleError(res, error);
    }
  };

  /** Test delivery — useful for verifying endpoint */
  static testDelivery = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      // Simple test: publish a test event to this subscription only if owned
      const subs = await webhookService.listSubscriptions(userId);
      const target = subs.find((s) => s.id === id);
      if (!target)
        return res.status(404).json({ success: false, message: 'Subscription not found' });

      const payload: any = {
        eventId: `test-${Date.now()}`,
        eventType: 'test.event',
        timestamp: new Date().toISOString(),
        message: 'Test webhook delivery',
      };
      await (webhookService as any).deliver(target.endpoint, payload, target.secret);
      return res.status(200).json({ success: true, message: 'Test event delivered' });
    } catch (error) {
      handleError(res, error);
    }
  };

  // Privy webhook handlers (Issues #603, #604, #605)
  static privyUserCreated = async (req: Request, res: Response) => {
    try {
      const { user_id, email, linked_accounts } = req.body;
      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required' });
      }

      logger.info({ privyUserId: user_id, email }, 'Privy user.created webhook received');

      // Check if user already exists
      const existingUser = await userRepo.findOne({ where: { privyUserId: user_id } });
      if (existingUser) {
        return res.status(200).json({ success: true, message: 'User already exists' });
      }

      // Create new user from Privy data
      const walletAddress = linked_accounts?.find((acc: any) => acc.type === 'wallet')?.address;
      const newUser = userRepo.create({
        privyUserId: user_id,
        email: email || null,
        walletAddress: walletAddress || null,
        role: UserRole.LISTENER,
        emailVerified: !!email,
      });
      await userRepo.save(newUser);

      logger.info({ userId: newUser.id, privyUserId: user_id }, 'User created from Privy webhook');
      return res.status(201).json({ success: true, message: 'User created successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Error in privyUserCreated webhook');
      handleError(res, error);
    }
  };

  static privyUserUpdated = async (req: Request, res: Response) => {
    try {
      const { user_id, email } = req.body;
      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required' });
      }

      logger.info({ privyUserId: user_id, email }, 'Privy user.updated webhook received');

      const user = await userRepo.findOne({ where: { privyUserId: user_id } });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Update user email if provided
      if (email && email !== user.email) {
        user.email = email;
        await userRepo.save(user);
        logger.info(
          { userId: user.id, privyUserId: user_id, email },
          'User email updated from Privy webhook',
        );
      }

      return res.status(200).json({ success: true, message: 'User updated successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Error in privyUserUpdated webhook');
      handleError(res, error);
    }
  };

  static privyUserLinkedAccount = async (req: Request, res: Response) => {
    try {
      const { user_id, account_type, account_address } = req.body;
      if (!user_id || !account_type) {
        return res
          .status(400)
          .json({ success: false, message: 'user_id and account_type are required' });
      }

      logger.info(
        { privyUserId: user_id, account_type, account_address },
        'Privy user.linked_account webhook received',
      );

      const user = await userRepo.findOne({ where: { privyUserId: user_id } });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Update wallet address if wallet account is linked
      if (account_type === 'wallet' && account_address && !user.walletAddress) {
        user.walletAddress = account_address;
        await userRepo.save(user);
        logger.info(
          { userId: user.id, privyUserId: user_id, walletAddress: account_address },
          'User wallet linked from Privy webhook',
        );
      }

      return res.status(200).json({ success: true, message: 'Account linked successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Error in privyUserLinkedAccount webhook');
      handleError(res, error);
    }
  };
}
