import 'reflect-metadata';
import { ApiKeyService } from '../services/ApiKeyService';
import { ApiKey } from '../entities/ApiKey';
import { User } from '../entities/User';
import { Permission } from '../types/Permissions';

describe('ApiKey scopes and permissions enforcement', () => {
  let apiKeyService: ApiKeyService;

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
  });

  it('grants permission if scope matches', () => {
    const apiKey = new ApiKey();
    apiKey.permissions = [];
    apiKey.scopes = [Permission.CONTENT_MODERATE];

    const user = new User();
    user.role = 'user';

    const hasPerm = apiKeyService.keyHasPermission(apiKey, user, Permission.CONTENT_MODERATE);
    expect(hasPerm).toBe(true);
  });

  it('rejects if scope is missing', () => {
    const apiKey = new ApiKey();
    apiKey.permissions = [];
    apiKey.scopes = ['read-only'];

    const user = new User();
    user.role = 'user';

    const hasPerm = apiKeyService.keyHasPermission(apiKey, user, Permission.CONTENT_MODERATE);
    expect(hasPerm).toBe(false);
  });
});
