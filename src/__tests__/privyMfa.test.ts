import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { AppError } from '../errors/AppError';
import { PrivyService } from '../services/PrivyService';
import { PrivyMfaController } from '../controllers/PrivyMfaController';

const APP_ID = 'clprivyapptestid000000000000';
const APP_SECRET = 'sk_test_privy_secret';
const API_URL = 'https://privy.test';

const ENV_KEYS = [
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'PRIVY_JWT_VERIFICATION_KEY',
  'PRIVY_API_URL',
];
const savedEnv: Record<string, string | undefined> = {};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

interface SignParams {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  privateKey: crypto.KeyObject;
  alg: 'ES256' | 'EdDSA';
}

function signToken({ header, payload, privateKey, alg }: SignParams): string {
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature =
    alg === 'ES256'
      ? crypto.sign('sha256', Buffer.from(signingInput), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        })
      : crypto.sign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'did:privy:ctestuser0000000000000000',
    sid: 'session-abc123',
    aud: APP_ID,
    iss: 'privy.io',
    iat: now,
    exp: now + 600,
    ...overrides,
  };
}

function es256Token(
  claims: Record<string, unknown>,
  keys: crypto.KeyPairKeyObjectResult,
  headerOverride: Record<string, unknown> = {},
): string {
  return signToken({
    header: { alg: 'ES256', typ: 'JWT', ...headerOverride },
    payload: claims,
    privateKey: keys.privateKey,
    alg: 'ES256',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockRequest(authorization?: string): ExpressRequest {
  const headers: Record<string, string> = authorization ? { authorization } : {};
  return {
    id: 'test-req',
    method: 'GET',
    originalUrl: '/api/auth/mfa/status',
    url: '/mfa/status',
    path: '/mfa/status',
    headers,
    body: {},
    ip: '127.0.0.1',
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as unknown as ExpressRequest;
}

function mockResponse(): ExpressResponse & { statusCode?: number; body?: unknown } {
  const res: Record<string, unknown> = {};
  res.statusCode = undefined;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res as unknown as ExpressResponse & { statusCode?: number; body?: unknown };
}

describe('PrivyService', () => {
  let ecKeys: crypto.KeyPairKeyObjectResult;
  let service: PrivyService;

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    ecKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.PRIVY_APP_ID = APP_ID;
    process.env.PRIVY_APP_SECRET = APP_SECRET;
    process.env.PRIVY_JWT_VERIFICATION_KEY = ecKeys.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    process.env.PRIVY_API_URL = API_URL;
    service = new PrivyService();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  describe('verifyAccessToken', () => {
    it('accepts a valid ES256 token', () => {
      const claims = service.verifyAccessToken(es256Token(validClaims(), ecKeys));
      expect(claims.sub).toBe('did:privy:ctestuser0000000000000000');
      expect(claims.sid).toBe('session-abc123');
      expect(claims.aud).toBe(APP_ID);
      expect(claims.iss).toBe('privy.io');
    });

    it('accepts the https://privy.io issuer variant', () => {
      const token = es256Token(validClaims({ iss: 'https://privy.io' }), ecKeys);
      expect(service.verifyAccessToken(token).iss).toBe('https://privy.io');
    });

    it('accepts an EdDSA (Ed25519) token', () => {
      const edKeys = crypto.generateKeyPairSync('ed25519');
      process.env.PRIVY_JWT_VERIFICATION_KEY = edKeys.publicKey.export({
        type: 'spki',
        format: 'pem',
      }) as string;
      const token = signToken({
        header: { alg: 'EdDSA', typ: 'JWT' },
        payload: validClaims(),
        privateKey: edKeys.privateKey,
        alg: 'EdDSA',
      });
      expect(service.verifyAccessToken(token).sub).toBe('did:privy:ctestuser0000000000000000');
    });

    it('accepts a JWK-formatted verification key', () => {
      const jwk = ecKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
      process.env.PRIVY_JWT_VERIFICATION_KEY = JSON.stringify(jwk);
      expect(service.verifyAccessToken(es256Token(validClaims(), ecKeys)).aud).toBe(APP_ID);
    });

    it('accepts a base64 SPKI-DER verification key', () => {
      const der = ecKeys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
      process.env.PRIVY_JWT_VERIFICATION_KEY = der.toString('base64');
      expect(service.verifyAccessToken(es256Token(validClaims(), ecKeys)).aud).toBe(APP_ID);
    });

    it('rejects an expired token', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = es256Token(validClaims({ iat: now - 7200, exp: now - 3600 }), ecKeys);
      expect(() => service.verifyAccessToken(token)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_EXPIRED' }),
      );
    });

    it('rejects a token for another audience', () => {
      const token = es256Token(validClaims({ aud: 'someone_elses_app' }), ecKeys);
      expect(() => service.verifyAccessToken(token)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_INVALID_AUDIENCE' }),
      );
    });

    it('rejects a token with another issuer', () => {
      const token = es256Token(validClaims({ iss: 'evil.example.com' }), ecKeys);
      expect(() => service.verifyAccessToken(token)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_INVALID_ISSUER' }),
      );
    });

    it('rejects an alg:none token', () => {
      const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payload = b64url(JSON.stringify(validClaims()));
      expect(() => service.verifyAccessToken(`${header}.${payload}.sig`)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_BAD_ALGORITHM' }),
      );
    });

    it('rejects legacy HS256 JWTs signed with JWT_SECRET', () => {
      const legacy = jwt.sign(
        { id: 'user-1', role: 'listener' },
        process.env.JWT_SECRET || 'test-secret',
        { algorithm: 'HS256', expiresIn: '15m' },
      );
      expect(() => service.verifyAccessToken(legacy)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_BAD_ALGORITHM' }),
      );
    });

    it('rejects a token signed by a different EC key', () => {
      const attackerKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const token = es256Token(validClaims(), attackerKeys);
      expect(() => service.verifyAccessToken(token)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_INVALID_SIGNATURE' }),
      );
    });

    it('rejects a malformed token', () => {
      expect(() => service.verifyAccessToken('not-a-jwt')).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_MALFORMED' }),
      );
      expect(() => service.verifyAccessToken('a.b')).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_MALFORMED' }),
      );
      expect(() => service.verifyAccessToken('')).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'PRIVY_TOKEN_MISSING' }),
      );
    });

    it('fails closed when the verification key is not configured', () => {
      delete process.env.PRIVY_JWT_VERIFICATION_KEY;
      expect(() => service.verifyAccessToken(es256Token(validClaims(), ecKeys))).toThrow(AppError);
      try {
        service.verifyAccessToken(es256Token(validClaims(), ecKeys));
      } catch (error) {
        expect((error as AppError).statusCode).toBe(502);
        expect((error as AppError).code).toBe('PRIVY_NOT_CONFIGURED');
      }
    });

    it('rejects an unparseable verification key', () => {
      process.env.PRIVY_JWT_VERIFICATION_KEY = 'definitely-not-a-public-key';
      expect(() => service.verifyAccessToken(es256Token(validClaims(), ecKeys))).toThrow(
        expect.objectContaining({ statusCode: 500, code: 'PRIVY_KEY_INVALID' }),
      );
    });
  });

  describe('getMfaStatus', () => {
    it('maps mfa_methods from the Privy user object', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({
          id: 'did:privy:ctestuser0000000000000000',
          mfa_methods: [
            { type: 'totp', verified_at: 1741194420 },
            { type: 'sms' },
            { type: 'totp' },
          ],
        }),
      );
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      const status = await svc.getMfaStatus('did:privy:ctestuser0000000000000000');

      expect(status).toEqual({
        privyUserId: 'did:privy:ctestuser0000000000000000',
        enrolledInMfa: true,
        mfaMethods: ['totp', 'sms'],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API_URL}/v1/users/did%3Aprivy%3Actestuser0000000000000000`);
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
      );
      expect(init.headers['privy-app-id']).toBe(APP_ID);
    });

    it('reports enrolledInMfa=false when no methods exist', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: 'did:privy:ctestuser0000000000000000', mfa_methods: [] }),
        );
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      const status = await svc.getMfaStatus('did:privy:ctestuser0000000000000000');

      expect(status.enrolledInMfa).toBe(false);
      expect(status.mfaMethods).toEqual([]);
    });

    it('maps a 404 to a not-found AppError', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('User not found', { status: 404 }));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await expect(svc.getMfaStatus('did:privy:missing')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, code: 'PRIVY_USER_NOT_FOUND' }),
      );
    });

    it('maps other non-2xx responses to a 502 external-service error', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response('oops', { status: 500 }));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await expect(svc.getMfaStatus('did:privy:ctestuser0000000000000000')).rejects.toThrow(
        expect.objectContaining({ statusCode: 502, code: 'PRIVY_API_ERROR' }),
      );
    });

    it('maps an invalid JSON body to a 502 external-service error', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await expect(svc.getMfaStatus('did:privy:ctestuser0000000000000000')).rejects.toThrow(
        expect.objectContaining({ statusCode: 502, code: 'PRIVY_API_INVALID_RESPONSE' }),
      );
    });

    it('maps a network failure to a 502 external-service error', async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await expect(svc.getMfaStatus('did:privy:ctestuser0000000000000000')).rejects.toThrow(
        expect.objectContaining({ statusCode: 502, code: 'PRIVY_API_UNREACHABLE' }),
      );
    });
  });

  describe('revokeAllSessions', () => {
    it('posts to the sessions/revoke endpoint', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await svc.revokeAllSessions('did:privy:ctestuser0000000000000000');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        `${API_URL}/v1/users/did%3Aprivy%3Actestuser0000000000000000/sessions/revoke`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers['privy-app-id']).toBe(APP_ID);
    });

    it('maps non-2xx responses to AppErrors', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response('nope', { status: 500 }));
      const svc = new PrivyService(fetchMock as unknown as typeof fetch);

      await expect(svc.revokeAllSessions('did:privy:x')).rejects.toThrow(
        expect.objectContaining({ statusCode: 502, code: 'PRIVY_API_ERROR' }),
      );
    });
  });
});

describe('PrivyMfaController', () => {
  const claims = {
    sub: 'did:privy:ctestuser0000000000000000',
    sid: 'session-abc123',
    aud: APP_ID,
    iss: 'privy.io',
    iat: 1,
    exp: 9_999_999_999,
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.PRIVY_APP_ID = APP_ID;
    process.env.PRIVY_APP_SECRET = APP_SECRET;
    process.env.PRIVY_JWT_VERIFICATION_KEY = crypto
      .generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .publicKey.export({ type: 'spki', format: 'pem' }) as string;
    process.env.PRIVY_API_URL = API_URL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it('returns MFA status for a verified Privy token', async () => {
    const stub = {
      verifyAccessToken: jest.fn().mockReturnValue(claims),
      getMfaStatus: jest.fn().mockResolvedValue({
        privyUserId: claims.sub,
        enrolledInMfa: true,
        mfaMethods: ['totp'],
      }),
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new PrivyMfaController(stub as unknown as PrivyService);
    const res = mockResponse();

    await controller.status(mockRequest('Bearer some-token'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      privyUserId: claims.sub,
      enrolledInMfa: true,
      mfaMethods: ['totp'],
      sessionId: 'session-abc123',
    });
    expect(stub.verifyAccessToken).toHaveBeenCalledWith('some-token');
    expect(stub.getMfaStatus).toHaveBeenCalledWith(claims.sub);
  });

  it('rejects a request without an Authorization header', async () => {
    const controller = new PrivyMfaController();
    const res = mockResponse();

    await controller.status(mockRequest(), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false, type: 'UNAUTHORIZED' });
  });

  it('rejects a malformed bearer token', async () => {
    const controller = new PrivyMfaController();
    const res = mockResponse();

    await controller.status(mockRequest('Bearer garbage'), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false, type: 'UNAUTHORIZED' });
  });

  it('revokes all sessions for a verified Privy token', async () => {
    const stub = {
      verifyAccessToken: jest.fn().mockReturnValue(claims),
      getMfaStatus: jest.fn(),
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new PrivyMfaController(stub as unknown as PrivyService);
    const res = mockResponse();

    await controller.revokeSessions(mockRequest('Bearer some-token'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, privyUserId: claims.sub });
    expect(stub.revokeAllSessions).toHaveBeenCalledWith(claims.sub);
  });

  it('passes AppErrors through to the response', async () => {
    const stub = {
      verifyAccessToken: jest.fn().mockReturnValue(claims),
      getMfaStatus: jest
        .fn()
        .mockRejectedValue(AppError.externalService('down', undefined, 'PRIVY_API_ERROR')),
      revokeAllSessions: jest.fn(),
    };
    const controller = new PrivyMfaController(stub as unknown as PrivyService);
    const res = mockResponse();

    await controller.status(mockRequest('Bearer some-token'), res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ success: false, type: 'EXTERNAL_SERVICE_ERROR' });
  });
});
