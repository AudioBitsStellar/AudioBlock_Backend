/**
 * Tests for Privy authentication methods (Issues #609, #610, #611, #613)
 *
 * This test suite covers:
 * - Account linking (email + wallet)
 * - Social login providers (Google, Twitter/X)
 * - SMS/Email OTP login
 * - External wallet connections (MetaMask, WalletConnect)
 */

import { AuthService } from '../services/AuthService';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';

describe('Privy Authentication Methods', () => {
  let authService: AuthService;
  let userRepo: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    authService = new AuthService();
    userRepo = AppDataSource.getRepository(User);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await userRepo.delete({});
  });

  describe('Issue #609: Account Linking (Email + Wallet)', () => {
    it('should link Privy account to existing email user', async () => {
      // Create existing user with email
      const existingUser = userRepo.create({
        email: 'test@example.com',
        emailVerified: true,
        role: UserRole.LISTENER,
      });
      await userRepo.save(existingUser);

      // Create Privy token with same email
      const payload = {
        sub: 'did:privy:test123',
        email: 'test@example.com',
        email_verified: true,
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.id).toBe(existingUser.id);
      expect(result.user.email).toBe('test@example.com');

      // Verify Privy ID was linked
      const updatedUser = await userRepo.findOne({ where: { id: existingUser.id } });
      expect(updatedUser.privyUserId).toBe('did:privy:test123');
    });

    it('should link Privy account to existing wallet user', async () => {
      // Create existing user with wallet
      const existingUser = userRepo.create({
        walletAddress: '0x1234567890abcdef',
        role: UserRole.LISTENER,
      });
      await userRepo.save(existingUser);

      // Create Privy token with same wallet
      const payload = {
        sub: 'did:privy:test456',
        wallet_address: '0x1234567890abcdef',
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.id).toBe(existingUser.id);
      expect(result.user.walletAddress).toBe('0x1234567890abcdef');

      // Verify Privy ID was linked
      const updatedUser = await userRepo.findOne({ where: { id: existingUser.id } });
      expect(updatedUser.privyUserId).toBe('did:privy:test456');
    });

    it('should NOT link on unverified email', async () => {
      // Create existing user with email
      const existingUser = userRepo.create({
        email: 'test@example.com',
        emailVerified: true,
        role: UserRole.LISTENER,
      });
      await userRepo.save(existingUser);

      // Create Privy token with unverified email
      const payload = {
        sub: 'did:privy:test789',
        email: 'test@example.com',
        email_verified: false, // NOT verified
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      // Should create NEW user, not link to existing
      expect(result.user.id).not.toBe(existingUser.id);
    });

    it('should create new user when no existing account matches', async () => {
      const payload = {
        sub: 'did:privy:newuser',
        email: 'newuser@example.com',
        email_verified: true,
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.email).toBe('newuser@example.com');

            name: 'John Doe',
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.email).toBe('user@gmail
_id_123',
            name: 'John Doe',
            profile_picture_url: 'https://example.com/avatar.jpg',
            verified: true,
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      // Verify Twitter data was stored
      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:twitter123' } });
      expect(user.twitterUsername).toBe('johndoe');
      expect(user.twitterId).toBe('twitter_id_123
er@gmail.com',
            verified_email: true,
          },
          {
            type: 'twitter',
            username: 'johndoe',
            subject: 'twitter_123',
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      const user = await userRepo.findOne({ where: { privyUserId: 'did:privy:multi123' } });
      expect(user.email).toBe('user@gmail.com');
      expect(user.twitterUsername).toBe('johndoe');
      expect(user.twitterConnected).toBe(true);
    });
  });

  describe('Issue #611: SMS/Email OTP Login', () => {
    it('should handle email OTP authentication', async () => {
      const payload = {
        sub: 'did:privy:email_otp',
        email: 'otp@example.com',
        email_verified: true, // OTP-verified emails are verified by default
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.email).toBe('otp@example.com');
      expect(result.user.emailVerified).toBe(true);
    });

    it('should acknowledge phone number in token payload', async () => {
      const payload = {
        sub: 'did:privy:phone_otp',
        phone: '+1234567890',
        phone_number: '+1234567890',
      };
      const token = createMockPrivyToken(payload);

      // Should not throw error
      const result = await authService.privyLogin(token);
      expect(result.user.privyUserId).toBe('did:privy:phone_otp');
    });
  });

  describe('Issue #613: External Wallet Connect', () => {
    it('should handle MetaMask wallet connection', async () => {
      const payload = {
        sub: 'did:privy:metamask123',
        linked_accounts: [
          {
            type: 'wallet',
            address: '0xMetaMaskAddress',
            wallet_client: 'metamask',
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.walletAddress).toBe('0xMetaMaskAddress');
    });

    it('should handle WalletConnect connection', async () => {
      const payload = {
        sub: 'did:privy:wc123',
        linked_accounts: [
          {
            type: 'wallet',
            address: '0xWalletConnectAddress',
            connector_type: 'wallet_connect',
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.user.walletAddress).toBe('0xWalletConnectAddress');
    });

    it('should handle injected wallet (generic)', async () => {
      const payload = {
        sub: 'did:privy:injected123',
        linked_accounts: [
          {
            type: 'wallet',
            address: '0xInjectedWalletAddress',
            connector_type: 'injected',
          },
        ],
      };
      const token = createMockPrivyToken(payload);

      const result = await authService.privyLogin(token);

      expect(result.us
yLogin(token);

      expect(result.user.walletAddress).toBe('0xExternalWallet');
    });
  });

  describe('Complex Account Linking Scenarios', () => {
    it('should link wallet to existing email account', async () => {
      // User signs up with email first
      const emailPayload = {
        sub: 'did:privy:user1',
        email: 'user@example.com',
        email_verified: true,
      };
      const emailToken = createMockPrivyToken(emailPayload);
      const firstLogin = await authService.privyLogin(emailT
(secondLogin.user.id).toBe(firstLogin.user.id);
      expect(secondLogin.user.email).toBe('user@example.com');
      expect(secondLogin.user.walletAddress).toBe('0xNewWallet');
    });

    it('should link social account to existing wallet account', async () => {
      // User signs up with wallet first
      const walletPayload = {
        sub: 'did:privy:user2',
        wallet_address: '0xWallet123',
      };
      const walletToken = createMockPrivyToken(walletPayload);
      const firstLogin = await auth
 be same user
      expect(secondLogin.user.id).toBe(firstLogin.user.id);
      expect(secondLogin.user.walletAddress).toBe('0xWallet123');

      // Verify Twitter was linked
      const user = await userRepo.findOne({ where: { id: firstLogin.user.id } });
      expect(user.twitterUsername).toBe('cryptouser');
      expect(user.twitterConnected).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid token format', async () => {
      await expect(authService.privyLogin('invalid.token')).rejects.toThrow(AppError);
    });

    it('should reject token without sub claim', async () => {
      const payload = {
        email: 'test@example.com',
        // Missing sub
      };
      const token = createMockPrivyToken(payload);

      await expect(authService.privyLogin(token)).rejects.toThrow('Privy user ID (sub) is required');
    });

    it('should reject empty token', async () => {
      await expect(authService.privyLogin('')).rejects.toThrow('Privy ID token is required');
    });

    it('should reject malformed JWT', async () => {
      await expect(authService.privyLogin('not.a.jwt.at.all')).rejects.toThrow();
    });
  });
});

/**
 * Helper function to create mock Privy tokens for testing
 * Note: In real tests, this would use proper JWT signing
 */
function createMockPrivyToken(payload: any): string {
  const header = { alg: 'ES256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'mock_signature';
  return `${headerB64}.${payloadB64}.${signature}`;
}
