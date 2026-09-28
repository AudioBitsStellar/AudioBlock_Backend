import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticateRequest } from '../authMiddleware';
import { PrivyJwksCache } from '../../services/privy/PrivyJwksCache';
import { PrivyUserResolver } from '../../services/privy/PrivyUserResolver';
import { UserRole } from '../../entities/User';
import { AppError } from '../../errors/AppError';
import { PrivyUserNotSyncedError } from '../../services/privy/PrivyErrors';

const APP_ID = 'test-app-id';
const DID = 'did:privy:abc123';
const JWT_SECRET = 'test-secret';

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'ES256', use: 'sig' },
    pem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  };
}

const mintPrivyToken = (pem: string) =>
  jwt.sign({ sub: DID, aud: APP_ID, iss: 'privy.io', sid: 'sess_1' }, pem, {
    algorithm: 'ES256',
    expiresIn: 3600,
    header: { typ: 'JWT', alg: 'ES256', kid: 'kid-1' },
  });

const mintLegacyToken = (claims: Record<string, unknown> = {}) =>
  jwt.sign({ id: 'user-1', role: UserRole.LISTENER, ...claims }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: 900,
  });

/** Minimal Response double that records the status and body it was sent. */
function makeRes() {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

const makeReq = (token?: string) =>
  ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: '/api/songs',
    ip: '127.0.0.1',
  }) as any;

describe('authMiddleware — AUTH_MODE dispatch (#636)', () => {
  const originalEnv = { ...process.env };
  let jwksCache: PrivyJwksCache;
  let resolver: PrivyUserResolver;
  let localUser: Record<string, unknown>;

  beforeEach(() => {
    process.env.PRIVY_APP_ID = APP_ID;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.PRIVY_JWKS_TTL_MS = '60000';
    process.env.PRIVY_RETRY_ATTEMPTS = '1';

    localUser = {
      id: 'user-1',
      role: UserRole.ARTIST,
      email: 'artist@example.com',
      emailVerified: true,
      deletedAt: null,
      deletionRequestedAt: null,
    };
    resolver = { resolve: jest.fn().mockResolvedValue(localUser) } as unknown as PrivyUserResolver;
  });

  afterEach(() => {
    for (const key of [
      'AUTH_MODE',
      'PRIVY_APP_ID',
      'JWT_SECRET',
      'PRIVY_JWKS_TTL_MS',
      'PRIVY_RETRY_ATTEMPTS',
      'PRIVY_ALLOW_LEGACY_FALLBACK',
    ]) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  /**
   * A cache seeded with the key that signed the token, so verification succeeds
   * without touching the network.
   */
  const cacheFor = (pemKeypair: { jwk: unknown }) =>
    new PrivyJwksCache({
      fetchJwks: jest.fn().mockResolvedValue({ keys: [pemKeypair.jwk] }) as never,
    });

  const run = async (token?: string, cache: PrivyJwksCache | null = null) => {
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();
    await authenticateRequest(req, res, next, resolver, cache);
    return { req, res, next };
  };

  describe('legacy mode (the default)', () => {
    it('authenticates a legacy token and records the method', async () => {
      const { req, next } = await run(mintLegacyToken());

      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ id: 'user-1', authMethod: 'legacy' });
    });

    it('rejects a Privy token, because Privy auth is off', async () => {
      const { jwk, pem } = makeKeypair();
      const { res, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('401s a request with no token', async () => {
      const { res, next } = await run();
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('never contacts Privy for a legacy token', async () => {
      // The legacy path must not depend on Privy being reachable or configured.
      const { next } = await run(mintLegacyToken(), null);
      expect(next).toHaveBeenCalled();
    });

    it('401s a legacy token with a bad signature', async () => {
      const forged = jwt.sign({ id: 'user-1' }, 'not-the-secret', { algorithm: 'HS256' });
      const { res, next } = await run(forged);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('privy mode', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'privy';
    });

    it('authenticates a valid Privy token and resolves the local account', async () => {
      const { jwk, pem } = makeKeypair();
      const { req, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));

      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ id: 'user-1', role: UserRole.ARTIST, authMethod: 'privy' });
    });

    it('reports a retryable 503 when Privy is not configured at all', async () => {
      const { pem } = makeKeypair();
      // cache === null is what a deployment with no PRIVY_APP_ID looks like.
      const { res, next } = await run(mintPrivyToken(pem), null);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });

    it('rejects a legacy token', async () => {
      const { res, next } = await run(mintLegacyToken());
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('both mode (staged rollout)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'both';
    });

    it('routes a legacy token to the legacy verifier', async () => {
      const { req, next } = await run(mintLegacyToken());
      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ authMethod: 'legacy' });
    });

    it('routes a Privy token to the Privy verifier', async () => {
      const { jwk, pem } = makeKeypair();
      const { req, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));
      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ authMethod: 'privy' });
    });

    it('answers 409 — not 401 — when a Privy identity has no local account yet', async () => {
      // A 409 for the Privy user must not become a 401, which would make clients
      // discard a credential that is perfectly valid (#602 adds the sync endpoint).
      (resolver.resolve as jest.Mock).mockRejectedValue(new PrivyUserNotSyncedError(DID));
      const { jwk, pem } = makeKeypair();
      const { res, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));
      expect(next).not.toHaveBeenCalled();
      expect(res.body?.type).toBe('BUSINESS_LOGIC_ERROR');
    });
  });

  describe('downtime handling (Issue #635)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'both';
    });

    it('returns a retryable 503 — not a 401 — when Privy is unreachable', async () => {
      // A 401 would make clients discard valid sessions over a transient blip.
      const { PrivyKeyUnavailableError } = await import('../../services/privy/PrivyErrors');
      (resolver.resolve as jest.Mock).mockRejectedValue(
        new PrivyKeyUnavailableError('Privy is unavailable (circuit breaker open)'),
      );

      const { jwk, pem } = makeKeypair();
      const { res, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
      expect(res.body?.details?.retryable).toBe(true);
    });

    it('still authenticates a legacy token while Privy is down', async () => {
      const { PrivyKeyUnavailableError } = await import('../../services/privy/PrivyErrors');
      (resolver.resolve as jest.Mock).mockRejectedValue(new PrivyKeyUnavailableError('down'));

      const { req, next } = await run(mintLegacyToken());

      // This is the real fallback: the legacy path never touches the Privy API.
      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ authMethod: 'legacy' });
    });

    it('401s — never falls back — when Privy rejects the token itself', async () => {
      const { PrivyInvalidTokenError } = await import('../../services/privy/PrivyErrors');
      (resolver.resolve as jest.Mock).mockRejectedValue(
        new PrivyInvalidTokenError('bad signature'),
      );

      const { jwk, pem } = makeKeypair();
      const { res, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));

      // Falling back on a *rejection* would let an attacker present a forged
      // Privy token and be authenticated by the weaker legacy path.
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('fails every request with 503 when degraded and legacy fallback is disabled', async () => {
      // One uniform retryable failure beats a population split across two
      // behaviours mid-incident, which is why this switch exists.
      process.env.PRIVY_ALLOW_LEGACY_FALLBACK = 'false';
      const degraded = { isDegraded: () => true } as unknown as PrivyJwksCache;
      const { jwk, pem } = makeKeypair();

      const legacy = await run(mintLegacyToken(), degraded);
      expect(legacy.next).not.toHaveBeenCalled();
      expect(legacy.res.statusCode).toBe(503);

      const privy = await run(mintPrivyToken(pem), degraded);
      expect(privy.next).not.toHaveBeenCalled();
      expect(privy.res.statusCode).toBe(503);
      expect(jwk).toBeDefined();
    });

    it('leaves legacy traffic alone during an outage when fallback is enabled', async () => {
      const degraded = { isDegraded: () => true } as unknown as PrivyJwksCache;
      const { req, next } = await run(mintLegacyToken(), degraded);

      expect(next).toHaveBeenCalled();
      expect(req.user).toMatchObject({ authMethod: 'legacy' });
    });
  });

  describe('GDPR interaction (Issue #633)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'both';
    });

    it('refuses a pending-deletion account', async () => {
      (resolver.resolve as jest.Mock).mockRejectedValue(
        AppError.authorization('Account deletion is pending for this account'),
      );

      const { jwk, pem } = makeKeypair();
      const { res, next } = await run(mintPrivyToken(pem), cacheFor({ jwk }));
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });
});
