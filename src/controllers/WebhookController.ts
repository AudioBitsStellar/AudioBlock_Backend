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

  // Privy webhook handlers (Issues #603, #604, #605, #609, #610, #611, #613)
  static privyUserCreated = async (req: Request, res: Response) => {
    try {
      const { user_id, email, linked_accounts, phone } = req.body;
      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required' });
      }

      logger.info(
        { privyUserId: user_id, email, phone, linked_accounts },
        'Privy user.created webhook received',
      );

      // Check if user already exists
      const existingUser = await userRepo.findOne({ where: { privyUserId: user_id } });
      if (existingUser) {
        return res.status(200).json({ success: true, message: 'User already exists' });
      }

      // Extract account information from linked_accounts (Issues #609, #610, #611, #613)
      const walletAccount = linked_accounts?.find((acc: any) => acc.type === 'wallet');
      const googleAccount = linked_accounts?.find((acc: any) => acc.type === 'google');
      const twitterAccount = linked_accounts?.find((acc: any) => acc.type === 'twitter');

      // Create new user from Privy data with support for all authentication methods
      const newUser = userRepo.create({
        privyUserId: user_id,
        email: email || googleAccount?.email || null,
        walletAddress: walletAccount?.address || null,
        role: UserRole.LISTENER,
        emailVerified: !!email || googleAccount?.verified_email || false,
        // Social login data (Issue #610)
        twitterUsername: twitterAccount?.username || null,
        twitterId: twitterAccount?.subject || twitterAccount?.id || null,
        twitterDisplayName: twitterAccount?.name || null,
        twitterProfileImage: twitterAccount?.profile_picture_url || null,
        twitterVerified: twitterAccount?.verified || false,
        twitterConnected: !!twitterAccount,
      });
      await userRepo.save(newUser);

      logger.info(
        {
          userId: newUser.id,
          privyUserId: user_id,
          hasEmail: !!newUser.email,
          hasWallet: !!newUser.walletAddress,
          hasTwitter: !!newUser.twitterConnected,
        },
        'User created from Privy webhook with linked accounts',
      );
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
      const { user_id, account_type, account_address, account } = req.body;
      if (!user_id || !account_type) {
        return res
          .status(400)
          .json({ success: false, message: 'user_id and account_type are required' });
      }

      logger.info(
        { privyUserId: user_id, account_type, account_address, account },
        'Privy user.linked_account webhook received',
      );

      const user = await userRepo.findOne({ where: { privyUserId: user_id } });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      let updated = false;

      // Issue #613: Handle external wallet connections (MetaMask, WalletConnect)
      if (account_type === 'wallet' && account_address) {
        if (!user.walletAddress) {
          user.walletAddress = account_address;
          updated = true;
          logger.info(
            {
              userId: user.id,
              privyUserId: user_id,
              walletAddress: account_address,
              walletClient: account?.wallet_client || account?.connector_type,
            },
            'External wallet linked from Privy webhook',
          );
        }
      }

      // Issue #610: Handle social login providers (Google, Twitter/X)
      if (account_type === 'google' && account) {
        if (account.email && !user.email) {
          user.email = account.email;
          user.emailVerified = account.verified_email || false;
          updated = true;
          logger.info(
            { userId: user.id, privyUserId: user_id, email: account.email },
            'Google account linked from Privy webhook',
          );
        }
      }

      if (account_type === 'twitter' && account) {
        if (account.username && !user.twitterUsername) {
          user.twitterUsername = account.username;
          user.twitterId = account.subject || account.id;
          user.twitterDisplayName = account.name;
          user.twitterProfileImage = account.profile_picture_url;
          user.twitterVerified = account.verified || false;
          user.twitterConnected = true;
          updated = true;
          logger.info(
            { userId: user.id, privyUserId: user_id, twitterUsername: account.username },
            'Twitter account linked from Privy webhook',
          );
        }
      }

      // Issue #611: Handle phone/SMS linking
      if (account_type === 'phone' && account?.phone_number) {
        // Phone numbers are stored as verified contact info but not in a dedicated column yet
        // This webhook acknowledges the linking for future enhancement
        logger.info(
          { userId: user.id, privyUserId: user_id, phone: account.phone_number },
          'Phone number linked from Privy webhook',
        );
      }

      // Issue #611: Handle email OTP linking
      if (account_type === 'email' && account?.address) {
        if (!user.email || user.email !== account.address) {
          user.email = account.address;
          user.emailVerified = true; // Email via OTP is verified by default
          updated = true;
          logger.info(
            { userId: user.id, privyUserId: user_id, email: account.address },
            'Email (OTP) linked from Privy webhook',
          );
        }
      }

      if (updated) {
        await userRepo.save(user);
      }

      return res.status(200).json({ success: true, message: 'Account linked successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Error in privyUserLinkedAccount webhook');
      handleError(res, error);
    }
  };
}
