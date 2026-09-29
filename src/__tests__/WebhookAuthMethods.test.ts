/**
 * Tests for Privy webhook handlers supporting new auth methods
 * (Issues #609, #610, #611, #613)
 */

import request from 'supertest';
import { WebhookController } from '../controllers/WebhookController';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import express, { Express } from 'express';

describe('Webhook Authentication Methods', () => {
  let app: Express;
  let userRepo: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    userRepo = AppDataSource.getRepository(User);

    // Setup express app for testing
    app = express();
    app.use(express.json());
    app.post('/webhooks/privy/user-created', WebhookController.privyUserCreated);
    app.post('/webhooks/privy/user-linked-account', WebhookController.privyUserLinkedAccount);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    await userRepo.delete({});
  });

  describe('user.created webhook with multiple auth methods', () => {
    it('should create user with Google account data', async () => {
      const webhookPayload = {
        user_id: 'did:privy:google_user',
        email: 'user@gmail.com',
        linked_accounts: [
          {
            type: 'google',
            email: 'user@gmail.com',
            verified_email: true,
          },
        ],
      };

      const response = await request(app)
        .post('/webhooks/privy/user-created')
        .send(webhookPayload)
        .expect(201);

      expect(response.body.success).toBe(true);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:google_user' } });
      expect(user).toBeDefined();
      expect(user.email).toBe('user@gmail.com');
      expect(user.emailVerified).toBe(true);
    });

    it('should create user with Twitter account data', async () => {
      const webhookPayload = {
        user_id: 'did:privy:twitter_user',
        linked_accounts: [
          {
            type: 'twitter',
            username: 'testuser',
            subject: 'twitter_123',
            name: 'Test User',
            profile_picture_url: 'https://example.com/pic.jpg',
            verified: true,
          },
        ],
      };

      const response = await request(app)
        .post('/webhooks/privy/user-created')
        .send(webhookPayload)
        .expect(201);

      expect(response.body.success).toBe(true);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:twitter_user' } });
      expect(user).toBeDefined();
      expect(user.twitterUsername).toBe('testuser');
      expect(user.twitterId).toBe('twitter_123');
      expect(user.twitterDisplayName).toBe('Test User');
      expect(user.twitterProfileImage).toBe('https://example.com/pic.jpg');
      expect(user.twitterVerified).toBe(true);
      expect(user.twitterConnected).toBe(true);
    });

    it('should create user with wallet and social accounts', async () => {
      const webhookPayload = {
        user_id: 'did:privy:multi_user',
        email: 'user@example.com',
        linked_accounts: [
          {
            type: 'wallet',
            address: '0x1234567890',
          },
          {
            type: 'google',
            email: 'user@gmail.com',
            verified_email: true,
          },
          {
            type: 'twitter',
            username: 'cryptouser',
            subject: 'twitter_456',
          },
        ],
      };

      const response = await request(app)
        .post('/webhooks/privy/user-created')
        .send(webhookPayload)
        .expect(201);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:multi_user' } });
,
      });
      await userRepo.save(user);
    });

    it('should link MetaMask wallet (Issue #613)', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'wallet',
        account_address: '0xMetaMaskWallet',
        account: {
          wallet_client: 'metamask',
          address: '0xMetaMaskWallet',
        },
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      expect(response.body.success).toBe(true);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      expect(user.walletAddress).toBe('0xMetaMaskWallet');
    });

    it('should link WalletConnect wallet (Issue #613)', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'wallet',
        account_address: '0xWalletConnectAddress',
        account: {
          connector_type: 'wallet_connect',
          address: '0xWalletConnectAddress',
        },
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      expect(user.walletAddress).toBe('0xWalletConnectAddress');
    });

    it('should link Google account (Issue #610)', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'google',
        account: {
          email: 'newgoogle@gmail.com',
          verified_email: true,
        },
      };

      // User already has email, so Google email won't override
      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should link Twitter account (Issue #610)', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'twitter',
        account: {
          username: 'linkedtwitter',
          subject: 'twitter_789',
          name: 'Linked Twitter User',
          profile_picture_url: 'https://example.com/twitter.jpg',
          verified: false,
        },
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      expect(user.twitterUsername).toBe('linkedtwitter');
      expect(user.twitterId).toBe('twitter_789');
      expect(user.twitterDisplayName).toBe('Linked Twitter User');
      expect(user.twitterConnected).toBe(true);
    });

    it('should handle email OTP linking (Issue #611)', async () => {
      // Create user without email
      const noEmailUser = userRepo.create({
        privyUserId: 'did:privy:no_email_user',
        role: UserRole.LISTENER,
      });
      await userRepo.save(noEmailUser);

      const webhookPayload = {
        user_id: 'did:privy:no_email_user',
        account_type: 'email',
        account: {
          address: 'otp@example.com',
        },
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:no_email_user' } });
      expect(user.email).toBe('otp@example.com');
      expect(user.emailVerified).toBe(true); // OTP emails are verified
    });

    it('should acknowledge phone linking (Issue #611)', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'phone',
        account: {
          phone_number: '+1234567890',
        },
      };

      // Should not throw error, just acknowledge
      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should not override existing wallet address', async () => {
      // Update user to have wallet already
      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      user.walletAddress = '0xExistingWallet';
      await userRepo.save(user);

      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'wallet',
        account_address: '0xNewWallet',
      };

      await request(app).post('/webhooks/privy/user-linked-account').send(webhookPayload).expect(200);

      const updatedUser = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      // Should keep existing wallet
      expect(updatedUser.walletAddress).toBe('0xExistingWallet');
    });

    it('should not override existing Twitter when linking again', async () => {
      // Set up user with Twitter already
      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      user.twitterUsername = 'originaltwitter';
      user.twitterId = 'original_id';
      user.twitterConnected = true;
      await userRepo.save(user);

      const webhookPayload = {
        user_id: 'did:privy:base_user',
        account_type: 'twitter',
        account: {
          username: 'newtwitter',
          subject: 'new_id',
        },
      };

      await request(app).post('/webhooks/privy/user-linked-account').send(webhookPayload).expect(200);

      const updatedUser = await userRepo.findOne({ where: { privyUserId: 'did:privy:base_user' } });
      // Should keep original Twitter
      expect(updatedUser.twitterUsername).toBe('originaltwitter');
    });
  });

  describe('Error handling', () => {
    it('should return 400 for missing user_id in user.created', async () => {
      const webhookPayload = {
        email: 'test@example.com',
        // Missing user_id
      };

      const response = await request(app)
        .post('/webhooks/privy/user-created')
        .send(webhookPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('user_id');
    });

    it('should return 404 for user not found in linked_account', async () => {
      const webhookPayload = {
        user_id: 'did:privy:nonexistent',
        account_type: 'wallet',
        account_address: '0x123',
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    it('should return 400 for missing account_type in linked_account', async () => {
      const webhookPayload = {
        user_id: 'did:privy:base_user',
        // Missing account_type
        account_address: '0x123',
      };

      const response = await request(app)
        .post('/webhooks/privy/user-linked-account')
        .send(webhookPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle webhook for already existing user gracefully', async () => {
      // Create user first
      const user = userRepo.create({
        privyUserId: 'did:privy:existing',
        email: 'existing@example.com',
        role: UserRole.LISTENER,
      });
      await userRepo.save(user);

      // Try to create again via webhook
      const webhookPayload = {
        user_id: 'did:privy:existing',
        email: 'existing@example.com',
      };

      const response = await request(app)
        .post('/webhooks/privy/user-created')
        .send(webhookPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('already exists');
    });
  });
});
