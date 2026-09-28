import { Request, Response } from 'express';
import { requirePrivyAuth, decodePrivyToken } from '../privyMiddleware';
import * as privyConfigModule from '../../config/privy';

describe('Privy Middleware Unit Tests (Issue #621)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  const createValidJwt = (payload: object = {}, expOffsetSec = 3600): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const fullPayload = {
      sub: 'did:privy:usr_123456',
      email: 'artist@audioblock.com',
      walletAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXY',
      exp: Math.floor(Date.now() / 1000) + expOffsetSec,
      ...payload,
    };
    const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64');
    const signature = Buffer.from('mock_signature').toString('base64');
    return `${header}.${payloadB64}.${signature}`;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (privyConfigModule as any).isPrivyEnabled = true;
    privyConfigModule.privyConfig.verificationKey = 'test-verification-key';

    req = {
      headers: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    next = jest.fn();
  });

  describe('requirePrivyAuth middleware', () => {
    it('returns authentication error when Privy is disabled', () => {
      (privyConfigModule as any).isPrivyEnabled = false;
      req.headers = { authorization: `Bearer ${createValidJwt({})}` };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when authorization header is missing', () => {
      req.headers = {};

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Privy token required'),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when authorization header is not Bearer format', () => {
      req.headers = { authorization: 'Basic dXNlcjpwYXNz' };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Bearer token is empty or whitespace', () => {
      req.headers = { authorization: 'Bearer   ' };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when verification key is missing from config', () => {
      privyConfigModule.privyConfig.verificationKey = '';
      req.headers = { authorization: `Bearer ${createValidJwt({})}` };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is malformed or invalid', () => {
      req.headers = { authorization: 'Bearer not-a-valid-token' };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('successfully authenticates valid Privy token and attaches privyUser', () => {
      const token = createValidJwt({
        sub: 'did:privy:usr_test_999',
        email: 'user@privy.com',
        walletAddress: 'GABCD1234',
      });
      req.headers = { authorization: `Bearer ${token}` };

      requirePrivyAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.privyUser).toBeDefined();
      expect(req.privyUser?.id).toBe('did:privy:usr_test_999');
      expect(req.privyUser?.email).toBe('user@privy.com');
      expect(req.privyUser?.walletAddress).toBe('GABCD1234');
    });
  });

  describe('decodePrivyToken', () => {
    it('returns null for empty or non-string inputs', () => {
      expect(decodePrivyToken('')).toBeNull();
      expect(decodePrivyToken(null as any)).toBeNull();
      expect(decodePrivyToken(undefined as any)).toBeNull();
    });

    it('returns null for tokens not having 3 segments', () => {
      expect(decodePrivyToken('segment1.segment2')).toBeNull();
      expect(decodePrivyToken('s1.s2.s3.s4')).toBeNull();
    });

    it('returns null for unparseable payload JSON', () => {
      const header = Buffer.from('{"alg":"HS256"}').toString('base64');
      const badPayload = Buffer.from('invalid-json').toString('base64');
      expect(decodePrivyToken(`${header}.${badPayload}.sig`)).toBeNull();
    });

    it('returns null if sub or id is missing in payload', () => {
      const header = Buffer.from('{"alg":"HS256"}').toString('base64');
      const noSubPayload = Buffer.from(JSON.stringify({ email: 'test@example.com' })).toString('base64');
      expect(decodePrivyToken(`${header}.${noSubPayload}.sig`)).toBeNull();
    });

    it('returns null if token is expired', () => {
      const expiredToken = createValidJwt({}, -100); // 100 seconds in the past
      expect(decodePrivyToken(expiredToken)).toBeNull();
    });

    it('correctly decodes sub, email, and walletAddress from valid token', () => {
      const token = createValidJwt({
        sub: 'privy_user_xyz',
        email: 'listener@block.io',
        walletAddress: 'GA1234567890',
      });
      const user = decodePrivyToken(token);
      expect(user).toEqual({
        id: 'privy_user_xyz',
        email: 'listener@block.io',
        walletAddress: 'GA1234567890',
      });
    });
  });
});
