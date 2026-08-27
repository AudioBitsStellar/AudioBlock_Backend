import 'reflect-metadata';
import { ApiKeyService } from '../services/ApiKeyService';
import { ApiKeyScope } from '../entities/ApiKey';
import { requireApiKeyScope } from '../middlewares/apiKeyMiddleware';
import { createMockRequest, createMockResponse } from '../../tests/helpers';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

describe('ApiKey Scopes & Enforcement', () => {
  let apiKeyService: ApiKeyService;

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
  });

  it('correctly evaluates scope permissions', () => {
    const keyRead = { scopes: [ApiKeyScope.READ_ONLY] } as any;
    const keyUpload = { scopes: [ApiKeyScope.UPLOAD] } as any;
    const keyAdmin = { scopes: [ApiKeyScope.ADMIN] } as any;

    expect(apiKeyService.keyHasScope(keyRead, ApiKeyScope.READ_ONLY)).toBe(true);
    expect(apiKeyService.keyHasScope(keyRead, ApiKeyScope.UPLOAD)).toBe(false);

    expect(apiKeyService.keyHasScope(keyUpload, ApiKeyScope.UPLOAD)).toBe(true);
    expect(apiKeyService.keyHasScope(keyUpload, ApiKeyScope.READ_ONLY)).toBe(false);

    expect(apiKeyService.keyHasScope(keyAdmin, ApiKeyScope.READ_ONLY)).toBe(true);
    expect(apiKeyService.keyHasScope(keyAdmin, ApiKeyScope.UPLOAD)).toBe(true);
    expect(apiKeyService.keyHasScope(keyAdmin, ApiKeyScope.ADMIN)).toBe(true);
  });
});
