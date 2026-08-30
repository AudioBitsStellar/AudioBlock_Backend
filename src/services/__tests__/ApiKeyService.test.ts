import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../../config/db';
import { ApiKeyService } from '../ApiKeyService';
import { ApiKey, ApiKeyScope } from '../../entities/ApiKey';
import { User, UserRole } from '../../entities/User';
import { Permission } from '../../types/Permissions';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

const mockApiKeyRepo = {
  count: jest.fn(),
  create: jest.fn((entity) => entity),
  save: jest.fn((entity) => Promise.resolve({ id: KEY_ID, ...entity })),
  find: jest.fn(),
  findOne: jest.fn(),
};

const mockUserRepo = {
  findOne: jest.fn(),
};

function makeUser(role: UserRole = UserRole.ARTIST): User {
  const user = new User();
  user.id = USER_ID;
  user.role = role;
  return user;
}

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  const apiKey = new ApiKey();
  apiKey.id = KEY_ID;
  apiKey.userId = USER_ID;
  apiKey.name = 'Test key';
  apiKey.keyHash = 'hash';
  apiKey.scopes = [];
  apiKey.permissions = [];
  apiKey.rateLimitTier = 'standard';
  apiKey.revokedAt = undefined;
  apiKey.createdAt = new Date();
  Object.assign(apiKey, overrides);
  return apiKey;
}

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === ApiKey) return mockApiKeyRepo;
    if (entity === User) return mockUserRepo;
    return {};
  });
});

describe('ApiKeyService.createApiKey', () => {
  it('rejects issuance when a requested permission exceeds the caller role', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser(UserRole.LISTENER));
    const service = new ApiKeyService();

    await expect(
      service.createApiKey(USER_ID, 'Escalated key', [], [Permission.USER_MANAGE]),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockApiKeyRepo.save).not.toHaveBeenCalled();
  });

  it('rejects issuance for an unrecognized permission string', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser(UserRole.ADMIN));
    const service = new ApiKeyService();

    await expect(
      service.createApiKey(USER_ID, 'Bad key', [], ['not-a-real-permission']),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows issuance when requested permissions are within the caller role', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser(UserRole.MODERATOR));
    mockApiKeyRepo.count.mockResolvedValue(0);
    const service = new ApiKeyService();

    const created = await service.createApiKey(
      USER_ID,
      'Moderation key',
      [],
      [Permission.CONTENT_MODERATE],
    );

    expect(created.rawKey).toMatch(/^abk_/);
    expect(created.permissions).toEqual([Permission.CONTENT_MODERATE]);
  });

  it('defaults new keys to the standard rate-limit tier', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser());
    mockApiKeyRepo.count.mockResolvedValue(0);
    const service = new ApiKeyService();

    const created = await service.createApiKey(USER_ID, 'Default tier key');

    expect(created.rateLimitTier).toBe('standard');
  });

  it('rejects issuance once the active-key limit is reached', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser());
    mockApiKeyRepo.count.mockResolvedValue(20);
    const service = new ApiKeyService();

    await expect(service.createApiKey(USER_ID, 'One too many')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('counts only non-revoked keys toward the active-key limit', async () => {
    mockUserRepo.findOne.mockResolvedValue(makeUser());
    mockApiKeyRepo.count.mockResolvedValue(5);
    const service = new ApiKeyService();

    await service.createApiKey(USER_ID, 'Fine');

    expect(mockApiKeyRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
    );
  });
});

describe('ApiKeyService.validateApiKey — revoked-key rejection', () => {
  it('rejects a revoked key even when the hash matches', async () => {
    const rawKey = 'abk_' + 'a'.repeat(64);
    const { hashApiKey } = jest.requireActual('../../utils/apiKeyCrypto');
    const keyHash = hashApiKey(rawKey);

    mockApiKeyRepo.findOne.mockResolvedValue(
      makeApiKey({ keyHash, revokedAt: new Date(), user: makeUser() } as Partial<ApiKey>),
    );
    const service = new ApiKeyService();

    await expect(service.validateApiKey(rawKey)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('accepts an active (non-revoked) key', async () => {
    const rawKey = 'abk_' + 'b'.repeat(64);
    const { hashApiKey } = jest.requireActual('../../utils/apiKeyCrypto');
    const keyHash = hashApiKey(rawKey);
    const user = makeUser();

    mockApiKeyRepo.findOne.mockResolvedValue(
      makeApiKey({ keyHash, revokedAt: undefined, user } as Partial<ApiKey>),
    );
    const service = new ApiKeyService();

    const result = await service.validateApiKey(rawKey);

    expect(result.user).toBe(user);
  });

  it('rejects a malformed key before touching the database', async () => {
    const service = new ApiKeyService();

    await expect(service.validateApiKey('not-a-key')).rejects.toMatchObject({ statusCode: 401 });
    expect(mockApiKeyRepo.findOne).not.toHaveBeenCalled();
  });

  it('rejects when no key matches the hash', async () => {
    mockApiKeyRepo.findOne.mockResolvedValue(null);
    const service = new ApiKeyService();

    await expect(service.validateApiKey('abk_' + 'c'.repeat(64))).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('ApiKeyService.revokeApiKey', () => {
  it('revokes a key the caller owns', async () => {
    mockApiKeyRepo.findOne.mockResolvedValue(makeApiKey());
    const service = new ApiKeyService();

    const revoked = await service.revokeApiKey(USER_ID, KEY_ID);

    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(mockApiKeyRepo.save).toHaveBeenCalled();
  });

  it('is idempotent — revoking an already-revoked key does not error or re-save', async () => {
    const alreadyRevokedAt = new Date('2026-01-01T00:00:00Z');
    mockApiKeyRepo.findOne.mockResolvedValue(makeApiKey({ revokedAt: alreadyRevokedAt }));
    const service = new ApiKeyService();

    const result = await service.revokeApiKey(USER_ID, KEY_ID);

    expect(result.revokedAt).toBe(alreadyRevokedAt);
    expect(mockApiKeyRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to revoke a key owned by a different user', async () => {
    mockApiKeyRepo.findOne.mockResolvedValue(makeApiKey({ userId: OTHER_USER_ID }));
    const service = new ApiKeyService();

    await expect(service.revokeApiKey(USER_ID, KEY_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockApiKeyRepo.save).not.toHaveBeenCalled();
  });

  it('returns not-found for a key that does not exist', async () => {
    mockApiKeyRepo.findOne.mockResolvedValue(null);
    const service = new ApiKeyService();

    await expect(service.revokeApiKey(USER_ID, KEY_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('ApiKeyService.listApiKeys', () => {
  it('excludes revoked keys by default', async () => {
    mockApiKeyRepo.find.mockResolvedValue([]);
    const service = new ApiKeyService();

    await service.listApiKeys(USER_ID);

    expect(mockApiKeyRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      }),
    );
    const call = mockApiKeyRepo.find.mock.calls[0][0];
    expect(call.where).toHaveProperty('revokedAt');
  });

  it('includes revoked keys when explicitly requested', async () => {
    mockApiKeyRepo.find.mockResolvedValue([]);
    const service = new ApiKeyService();

    await service.listApiKeys(USER_ID, true);

    const call = mockApiKeyRepo.find.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID });
  });
});

describe('ApiKeyService.keyHasScope', () => {
  it('denies every scope for a key issued with none (fails closed)', () => {
    const service = new ApiKeyService();
    expect(service.keyHasScope(makeApiKey({ scopes: [] }), ApiKeyScope.READ_ONLY)).toBe(false);
  });

  it('grants only the scopes a key was issued', () => {
    const service = new ApiKeyService();
    const apiKey = makeApiKey({ scopes: [ApiKeyScope.READ_ONLY] });

    expect(service.keyHasScope(apiKey, ApiKeyScope.READ_ONLY)).toBe(true);
    expect(service.keyHasScope(apiKey, ApiKeyScope.UPLOAD)).toBe(false);
  });

  it('the admin scope grants every scope', () => {
    const service = new ApiKeyService();
    const apiKey = makeApiKey({ scopes: [ApiKeyScope.ADMIN] });

    expect(service.keyHasScope(apiKey, ApiKeyScope.UPLOAD)).toBe(true);
  });
});
