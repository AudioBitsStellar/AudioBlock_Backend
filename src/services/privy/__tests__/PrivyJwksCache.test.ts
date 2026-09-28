import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { PrivyJwksCache } from '../PrivyJwksCache';
import { PrivyKeyUnavailableError, PrivyUnknownKeyError } from '../PrivyErrors';
import { CircuitBreaker } from '../PrivyResilience';

const APP_ID = 'test-app-id';

/** Build a JWKS entry (with kid) for a freshly generated P-256 keypair. */
function makeJwk(kid: string) {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } as const;
}

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { jwk: publicKey.export({ format: 'jwk' }), privateKey };
}

/** Mint a Privy-shaped access token signed by `privateKey`. */
function mintToken(
  privateKey: ReturnType<typeof makeKeypair>['privateKey'],
  kid: string,
  overrides: Record<string, unknown> = {},
) {
  return jwt.sign(
    { sub: 'did:privy:abc123', aud: APP_ID, iss: 'privy.io', sid: 'sess_1', ...overrides },
    privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { algorithm: 'ES256', keyid: kid, header: { typ: 'JWT', alg: 'ES256' } },
  );
}

describe('PrivyJwksCache', () => {
  const originalEnv = { ...process.env };
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    process.env.PRIVY_APP_ID = APP_ID;
    process.env.PRIVY_JWKS_TTL_MS = '1000';
    process.env.PRIVY_JWKS_STALE_TTL_MS = '5000';
    process.env.PRIVY_JWKS_NEGATIVE_TTL_MS = '500';
    process.env.PRIVY_RETRY_ATTEMPTS = '1';
  });

  afterEach(() => {
    for (const key of [
      'PRIVY_APP_ID',
      'PRIVY_JWKS_TTL_MS',
      'PRIVY_JWKS_STALE_TTL_MS',
      'PRIVY_JWKS_NEGATIVE_TTL_MS',
      'PRIVY_RETRY_ATTEMPTS',
    ]) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  const build = (fetchJwks: () => Promise<{ keys?: unknown[] }>) =>
    new PrivyJwksCache({ now: () => now, fetchJwks: fetchJwks as never });

  describe('caching (Issue #634)', () => {
    it('fetches the JWKS once and serves subsequent lookups from memory', async () => {
      const jwk = makeJwk('kid-1');
      const fetchJwks = jest.fn().mockResolvedValue({ keys: [jwk] });
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      await cache.getKey('kid-1');
      await cache.getKey('kid-1');

      expect(fetchJwks).toHaveBeenCalledTimes(1);
    });

    it('returns a key that actually verifies a token signed by the matching key', async () => {
      const { jwk, privateKey } = makeKeypair();
      const cache = build(jest.fn().mockResolvedValue({ keys: [{ ...jwk, kid: 'kid-1' }] }));

      const key = await cache.getKey('kid-1');
      const token = mintToken(privateKey, 'kid-1');

      // Must not throw: this is the assertion that matters, since a cached key
      // that silently fails to import would otherwise look like a cache hit.
      expect(() =>
        jwt.verify(token, key, { algorithms: ['ES256'], issuer: 'privy.io', audience: APP_ID }),
      ).not.toThrow();
    });

    it('collapses concurrent misses onto a single fetch', async () => {
      const jwk = makeJwk('kid-1');
      let resolveFetch: (value: { keys: unknown[] }) => void = () => {};
      const fetchJwks = jest.fn(
        () =>
          new Promise<{ keys: unknown[] }>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const cache = build(fetchJwks);

      const all = Promise.all([
        cache.getKey('kid-1'),
        cache.getKey('kid-1'),
        cache.getKey('kid-1'),
      ]);
      resolveFetch({ keys: [jwk] });
      await all;

      expect(fetchJwks).toHaveBeenCalledTimes(1);
    });

    it('refetches once the TTL expires', async () => {
      const fetchJwks = jest.fn().mockResolvedValue({ keys: [makeJwk('kid-1')] });
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      now += 999;
      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      now += 2; // past the 1000ms TTL
      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });

    it('picks up a rotated key after the TTL lapses', async () => {
      const first = makeJwk('kid-1');
      const rotated = makeJwk('kid-2');
      const fetchJwks = jest
        .fn()
        .mockResolvedValueOnce({ keys: [first] })
        .mockResolvedValueOnce({ keys: [rotated] });
      const cache = build(fetchJwks);

      await expect(cache.getKey('kid-1')).resolves.toBeDefined();
      now += 1500;
      await expect(cache.getKey('kid-2')).resolves.toBeDefined();
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });
  });

  describe('unknown keys and anti-amplification', () => {
    it('rejects an unknown kid without refetching while the set is fresh', async () => {
      const fetchJwks = jest.fn().mockResolvedValue({ keys: [makeJwk('kid-1')] });
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      await expect(cache.getKey('kid-attacker')).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      await expect(cache.getKey('kid-attacker-2')).rejects.toBeInstanceOf(PrivyUnknownKeyError);

      // The whole point: random kids must not turn us into a load generator.
      expect(fetchJwks).toHaveBeenCalledTimes(1);
    });

    it('never tries every cached key when a token has no kid', async () => {
      const fetchJwks = jest.fn().mockResolvedValue({ keys: [makeJwk('kid-1')] });
      const cache = build(fetchJwks);

      await expect(cache.getKey('')).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      expect(fetchJwks).not.toHaveBeenCalled();
    });

    it('picks up a rotated kid after the cooldown, without waiting out the full TTL', async () => {
      // The property that matters: rotation is bounded by the short cooldown
      // (60s in production), not by the full key-set TTL (1h in production). An
      // hour-long lockout of every client holding the new key would be a severe
      // availability bug, so this asserts the bound is the cooldown.
      const fetchJwks = jest
        .fn()
        .mockResolvedValueOnce({ keys: [makeJwk('kid-1')] })
        .mockResolvedValueOnce({ keys: [makeJwk('kid-1'), makeJwk('kid-2')] });
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // The cooldown deliberately applies even to a first-seen kid, so that
      // random kids cannot each buy a request.
      await expect(cache.getKey('kid-2')).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // Still well inside the 1000ms key-set TTL...
      now += 600;
      await expect(cache.getKey('kid-2')).resolves.toBeDefined();
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });

    it('caps a flood of distinct unknown kids at one fetch per cooldown window', async () => {
      const fetchJwks = jest.fn().mockResolvedValue({ keys: [makeJwk('kid-1')] });
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // An attacker sending endless random kids must not turn us into a load
      // generator against our own JWKS endpoint.
      for (const kid of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        await expect(cache.getKey(`kid-${kid}`)).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      }
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // Once the window passes, the next new kid is allowed exactly one attempt.
      now += 600;
      await expect(cache.getKey('kid-late')).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      expect(fetchJwks).toHaveBeenCalledTimes(2);

      // ...and the flood is capped again until the next window.
      await expect(cache.getKey('kid-later-still')).rejects.toBeInstanceOf(PrivyUnknownKeyError);
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });
  });

  describe('graceful degradation (Issue #635)', () => {
    it('serves stale keys when a refresh fails inside the stale window', async () => {
      const fetchJwks = jest
        .fn()
        .mockResolvedValueOnce({ keys: [makeJwk('kid-1')] })
        .mockRejectedValueOnce(new Error('ECONNRESET'));
      const cache = build(fetchJwks);

      const first = await cache.getKey('kid-1');
      now += 1500; // TTL lapsed (1000), stale window still open (5000)

      const stale = await cache.getKey('kid-1');

      // Same key: verification keeps working through the outage.
      expect(stale).toBe(first);
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });

    it('raises an availability error once the stale window has also passed', async () => {
      const fetchJwks = jest
        .fn()
        .mockResolvedValueOnce({ keys: [makeJwk('kid-1')] })
        .mockRejectedValue(new Error('ECONNRESET'));
      const cache = build(fetchJwks);

      await cache.getKey('kid-1');
      now += 6000; // well past the 5000ms stale window

      await expect(cache.getKey('kid-1')).rejects.toBeInstanceOf(PrivyKeyUnavailableError);
    });

    it('raises an availability error on a cold start with no cache to fall back on', async () => {
      const fetchJwks = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const cache = build(fetchJwks);

      await expect(cache.getKey('kid-1')).rejects.toBeInstanceOf(PrivyKeyUnavailableError);
    });

    it('rejects a 200 response containing no usable keys', async () => {
      // An empty key set is a misconfiguration, not a valid empty cache. Accepting
      // it would reject every token AND clear the working cache.
      const cache = build(
        jest.fn().mockResolvedValue({ keys: [{ kty: 'RSA', kid: 'x', n: 'a', e: 'b' }] }),
      );

      await expect(cache.getKey('x')).rejects.toBeInstanceOf(PrivyKeyUnavailableError);
    });

    it('skips individual unusable entries instead of failing the whole set', async () => {
      const good = makeJwk('kid-1');
      const cache = build(
        jest.fn().mockResolvedValue({
          keys: [{ kty: 'RSA', kid: 'rsa-1', n: 'a', e: 'b' }, good, { kty: 'EC', crv: 'P-256' }],
        }),
      );

      await expect(cache.getKey('kid-1')).resolves.toBeDefined();
    });
  });

  describe('circuit breaker integration', () => {
    it('opens the breaker after repeated failures and reports degraded', async () => {
      process.env.PRIVY_CIRCUIT_FAILURE_THRESHOLD = '2';
      const breaker = new CircuitBreaker({
        name: 'privy',
        failureThreshold: 2,
        resetTimeoutMs: 10_000,
        now: () => now,
      });
      const cache = new PrivyJwksCache({
        now: () => now,
        fetchJwks: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        breaker,
      });

      await expect(cache.getKey('kid-1')).rejects.toBeInstanceOf(PrivyKeyUnavailableError);
      expect(cache.isDegraded()).toBe(false);

      // Second failure trips the breaker.
      now += 600;
      await expect(cache.getKey('kid-1')).rejects.toBeInstanceOf(PrivyKeyUnavailableError);
      expect(cache.isDegraded()).toBe(true);
    });
  });

  describe('introspection', () => {
    it('reports age and expiry for a health endpoint', async () => {
      const cache = build(jest.fn().mockResolvedValue({ keys: [makeJwk('kid-1')] }));
      expect(cache.getSnapshot().loaded).toBe(false);

      await cache.getKey('kid-1');
      now += 100;

      const snapshot = cache.getSnapshot();
      expect(snapshot.loaded).toBe(true);
      expect(snapshot.keyCount).toBe(1);
      expect(snapshot.ageMs).toBe(100);
      expect(snapshot.expiresInMs).toBe(900);
      expect(snapshot.servingStale).toBe(false);
    });
  });
});
