import 'reflect-metadata';
import { requireApiKeyScope } from '../middlewares/apiKeyMiddleware';
import { ApiKeyService } from '../services/ApiKeyService';

jest.mock('../services/ApiKeyService', () => {
  return {
    ApiKeyService: jest.fn().mockImplementation(() => ({
      validateApiKey: jest.fn().mockImplementation(async (key) => {
        if (key === 'valid-read-key') {
          return {
            apiKey: { id: '1', scopes: ['read-only'], revokedAt: null },
            user: { id: 'u1', role: 'user' },
          };
        }
        if (key === 'valid-admin-key') {
          return {
            apiKey: { id: '2', scopes: ['admin'], revokedAt: null },
            user: { id: 'u1', role: 'admin' },
          };
        }
        throw new Error('Invalid key');
      }),
      keyHasScope: jest.fn().mockImplementation((apiKey, scope) => {
        if (apiKey.scopes.includes('admin') || apiKey.scopes.includes(scope)) {
          return true;
        }
        return false;
      }),
    })),
  };
});

describe('ApiKey Scopes Middleware (#scopes)', () => {
  it('rejects a key with narrow scope trying to access out-of-scope routes', async () => {
    const req: any = {
      headers: { 'x-api-key': 'valid-read-key' },
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    const middleware = requireApiKeyScope('upload');
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows a key with matching scope to access the route', async () => {
    const req: any = {
      headers: { 'x-api-key': 'valid-read-key' },
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    const middleware = requireApiKeyScope('read-only');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
