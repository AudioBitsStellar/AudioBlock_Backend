import { AuthService } from '../services/AuthService';
import { User, UserRole } from '../entities/User';
import jwt from 'jsonwebtoken';

describe('Issue #642: Token Introspection Endpoint (RFC 7662)', () => {
  let authService: AuthService;
  const mockJwtSecret = 'test-jwt-secret-key-12345';

  beforeAll(() => {
    process.env.JWT_SECRET = mockJwtSecret;
  });

  beforeEach(() => {
    authService = new AuthService();
  });

  it('should return active: false when token is empty or invalid string', async () => {
    const res1 = await authService.introspectToken('');
    expect(res1).toEqual({ active: false });

    const res2 = await authService.introspectToken('not-a-jwt-token');
    expect(res2).toEqual({ active: false });
  });

  it('should return active: false when token signature is invalid or expired', async () => {
    const expiredToken = jwt.sign(
      { id: 'user-123', email: 'test@audioblock.io' },
      mockJwtSecret,
      { expiresIn: '-1s' }
    );

    const res = await authService.introspectToken(expiredToken);
    expect(res).toEqual({ active: false });
  });

  it('should return active: true and full claims when token is valid and user exists', async () => {
    const mockUser: Partial<User> = {
      id: 'user-uuid-456',
      email: 'artist@audioblock.io',
      role: UserRole.ARTIST,
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      stellarPublicKey: 'GBEMIAUDIOBLOCK...',
      username: 'cosmicartist',
      name: 'Cosmic Artist',
      emailVerified: true,
    };

    // Mock user repo findOne
    (authService as any).userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
    };

    const validToken = jwt.sign(
      {
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      },
      mockJwtSecret,
      { expiresIn: '15m' }
    );

    const res = await authService.introspectToken(validToken);

    expect(res.active).toBe(true);
    expect(res.sub).toBe(mockUser.id);
    expect(res.user_id).toBe(mockUser.id);
    expect(res.email).toBe(mockUser.email);
    expect(res.role).toBe(UserRole.ARTIST);
    expect(res.wallet_address).toBe(mockUser.walletAddress);
    expect(res.stellar_public_key).toBe(mockUser.stellarPublicKey);
    expect(res.username).toBe('cosmicartist');
    expect(res.client_id).toBe('audioblock-internal');
    expect(res.token_type).toBe('Bearer');
    expect(res.exp).toBeDefined();
    expect(res.iat).toBeDefined();
  });

  it('should return active: false when user in token is no longer in database', async () => {
    (authService as any).userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    const token = jwt.sign(
      { id: 'deleted-user', email: 'ghost@audioblock.io' },
      mockJwtSecret,
      { expiresIn: '15m' }
    );

    const res = await authService.introspectToken(token);
    expect(res).toEqual({ active: false });
  });
});
