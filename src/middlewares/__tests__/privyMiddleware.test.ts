import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { PrivyJwksCache, getPrivyJwksCacheSafe } from '../../services/privy/PrivyJwksCache';
import { requirePrivyAuth } from '../privyMiddleware';

// #703's config module calls validateEnvironment() at import time, which exits the
// process when required vars are missing. Stub it so this middleware can be tested
// without standing up a full environment.
jest.mock('../../config/privy', () => ({
  isPrivyEnabled: true,
  privyConfig: { appId: 'test-app-id', appSecret: 's', verificationKey: 'k' },
}));

// The middleware resolves its key cache through getPrivyJwksCacheSafe(); point it
// at an in-memory cache so no test touches the network.
jest.mock('../../services/privy/PrivyJwksCache', () => {
  const actual = jest.requireActual('../../services/privy/PrivyJwksCache');
  return { ...actual, getPrivyJwksCacheSafe: jest.fn() };
});

const APP_ID = 'test-app-id';
const DID = 'did:privy:abc123';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'ES256', use: 'sig' };
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;

const signPrivy = (claims: Record<string, unknown>, options: jwt.SignOptions = {}) =>
  jwt.sign(claims, PEM, {
    algorithm: 'ES256',
    expiresIn: 3600,
    header: { typ: 'JWT', alg: 'ES256', kid: 'kid-1' },
    ...options,
  });

const validToken = () => signPrivy({ sub: DID, aud: APP_ID, iss: 'privy.io', sid: 'sess_1' });

const makeReq = (token?: string) =>
  ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: '/api/auth/privy/refresh-token',
  }) as any;

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
};

const run = async (token?: string) => {
  const req = makeReq(token);
  const res = makeRes();
  const next = jest.fn();
  requirePrivyAuth(req, res, next);
  // Let the middleware's async body settle.
  await new Promise((resolve) => setImmediate(resolve));
  return { req, res, next };
};

describe('requirePrivyAuth — signature verification (P0 fix for #703)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRIVY_APP_ID = APP_ID;
    process.env.PRIVY_JWKS_TTL_MS = '60000';
    process.env.PRIVY_RETRY_ATTEMPTS = '1';

    const cache = new PrivyJwksCache({
      fetchJwks: jest.fn().mockResolvedValue({ keys: [JWK] }) as never,
    });
    (getPrivyJwksCacheSafe as jest.Mock).mockReturnValue(cache);
  });

  afterEach(() => {
    for (const k of ['PRIVY_APP_ID', 'PRIVY_JWKS_TTL_MS', 'PRIVY_RETRY_ATTEMPTS'])
      delete process.env[k];
    Object.assign(process.env, originalEnv);
  });

  it('accepts a genuinely signed Privy token', async () => {
    const { req, next } = await run(validToken());

    expect(next).toHaveBeenCalled();
    expect(req.privyUser).toEqual({ id: DID });
  });

  it('REJECTS a hand-crafted token with an arbitrary subject', async () => {
    // The vulnerability. The old implementation base64-decoded the payload and
    // trusted `sub`, so this was accepted as a real user — and the route it guards
    // mints a JWT_SECRET-signed session for that id, i.e. full account takeover.
    const forged = `x.${Buffer.from(JSON.stringify({ sub: 'did:privy:VICTIM' })).toString('base64url')}.y`;

    const { next, res } = await run(forged);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('REJECTS a token signed by an unrelated key', async () => {
    const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const forged = jwt.sign(
      { sub: DID, aud: APP_ID, iss: 'privy.io', sid: 's' },
      attacker.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      { algorithm: 'ES256', expiresIn: 3600, header: { typ: 'JWT', alg: 'ES256', kid: 'kid-1' } },
    );

    const { next, res } = await run(forged);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('REJECTS an expired token', async () => {
    const { next, res } = await run(
      signPrivy({ sub: DID, aud: APP_ID, iss: 'privy.io', sid: 's' }, { expiresIn: -60 }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('REJECTS a token minted for a different app', async () => {
    const { next, res } = await run(
      signPrivy({ sub: DID, aud: 'another-app', iss: 'privy.io', sid: 's' }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('REJECTS a token from a different issuer', async () => {
    const { next, res } = await run(
      signPrivy({ sub: DID, aud: APP_ID, iss: 'evil.example', sid: 's' }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('REJECTS an alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'none', kid: 'kid-1' })).toString(
      'base64url',
    );
    const body = Buffer.from(
      JSON.stringify({ sub: DID, aud: APP_ID, iss: 'privy.io', sid: 's', exp: 9999999999 }),
    ).toString('base64url');

    const { next, res } = await run(`${header}.${body}.`);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401s a request with no token', async () => {
    const { next, res } = await run();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
