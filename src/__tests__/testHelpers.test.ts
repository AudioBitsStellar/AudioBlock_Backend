import jwt from 'jsonwebtoken';
import {
  generateAuthToken,
  getTestJwtSecret,
  createMockRepository,
  setupTestDb,
  teardownTestDb,
  EntityClass,
  createMockResponse,
  createMockRequest,
  createAuthenticatedRequest,
  assertSuccessResponse,
  assertErrorResponse,
} from '../../tests/helpers';
import { requireAuth } from '../middlewares/authMiddleware';

describe('tests/helpers: auth', () => {
  it('signs a token verifiable with the shared test JWT secret', () => {
    const token = generateAuthToken('user-1', { role: 'artist' });
    const decoded = jwt.verify(token, getTestJwtSecret()) as jwt.JwtPayload;

    expect(decoded).toMatchObject({ id: 'user-1', role: 'artist' });
  });

  it('round-trips through the real requireAuth middleware', () => {
    const token = generateAuthToken('user-2', { role: 'listener' });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = createMockResponse();
    const next = jest.fn();

    requireAuth(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'user-2', role: 'listener' });
  });
});

describe('tests/helpers: db', () => {
  it('createMockRepository stubs the common CRUD methods', () => {
    const repo = createMockRepository();

    expect(jest.isMockFunction(repo.findOneBy)).toBe(true);
    expect(jest.isMockFunction(repo.save)).toBe(true);
  });

  it('setupTestDb wires getRepository to return a single mock repo', () => {
    const mockDataSource = { getRepository: jest.fn() };
    const repo = createMockRepository({ findOneBy: jest.fn().mockReturnValue({ id: '1' }) });

    setupTestDb(mockDataSource, repo);

    expect(mockDataSource.getRepository({} as any)).toBe(repo);

    teardownTestDb(mockDataSource);
    expect(mockDataSource.getRepository).not.toHaveBeenCalled();
  });

  it('setupTestDb dispatches per-entity when given a Map', () => {
    class EntityA {}
    class EntityB {}
    const mockDataSource = { getRepository: jest.fn() };
    const repoA = createMockRepository();
    const repoB = createMockRepository();

    setupTestDb(
      mockDataSource,
      new Map<EntityClass, ReturnType<typeof createMockRepository>>([
        [EntityA, repoA],
        [EntityB, repoB],
      ]),
    );

    expect(mockDataSource.getRepository(EntityA)).toBe(repoA);
    expect(mockDataSource.getRepository(EntityB)).toBe(repoB);
  });
});

describe('tests/helpers: http', () => {
  it('createMockRequest builds a plain request with no auth header', () => {
    const req = createMockRequest({ body: { name: 'x' } });

    expect(req.headers.authorization).toBeUndefined();
    expect(req.body).toEqual({ name: 'x' });
  });

  it('createAuthenticatedRequest sets the Authorization header and req.user', () => {
    const req = createAuthenticatedRequest({ userId: 'user-3', user: { role: 'artist' } });

    expect(req.headers.authorization).toMatch(/^Bearer /);
    expect(req.user).toMatchObject({ id: 'user-3', role: 'artist' });

    const token = req.headers.authorization.replace('Bearer ', '');
    const decoded = jwt.verify(token, getTestJwtSecret()) as jwt.JwtPayload;
    expect(decoded).toMatchObject({ id: 'user-3', role: 'artist' });
  });
});

describe('tests/helpers: assertions', () => {
  it('assertSuccessResponse passes for a { success: true, message, ...data } payload', () => {
    const res = createMockResponse();
    res.status(200);
    res.json({ success: true, message: 'ok', wallet: { accountAddress: '0xabc' } });

    assertSuccessResponse(res, { status: 200, data: { wallet: { accountAddress: '0xabc' } } });
  });

  it('assertErrorResponse tolerates { success: false, message }', () => {
    const res = createMockResponse();
    res.status(400);
    res.json({ success: false, message: 'bad input' });

    assertErrorResponse(res, { status: 400, message: 'bad input' });
  });

  it('assertErrorResponse tolerates a bare { message } with no success key', () => {
    const res = createMockResponse();
    res.status(400);
    res.json({ message: 'Dynamic: Wallet creation failed' });

    assertErrorResponse(res, { status: 400, message: /Wallet creation failed/ });
  });
});
