import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/ApiKeyService';
import { ApiKey, ApiKeyScope } from '../entities/ApiKey';
import { Permission } from '../types/Permissions';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import { createTieredApiRateLimiter } from './rateLimiter';

export const API_KEY_HEADER = 'x-api-key';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
    }
  }
}

const apiKeyService = new ApiKeyService();

function extractRawKey(req: Request): string | undefined {
  const headerKey = req.headers[API_KEY_HEADER];

  if (typeof headerKey === 'string' && headerKey.length > 0) {
    return headerKey;
  }

  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('ApiKey ')) {
    return authHeader.slice('ApiKey '.length).trim();
  }

  return undefined;
}

const tieredApiKeyLimiter = createTieredApiRateLimiter({
  standard: { windowMs: 60 * 1000, max: 100 },
  high: { windowMs: 60 * 1000, max: 500 },
  unlimited: { windowMs: 60 * 1000, max: 10000 },
});

/**
 * Authenticates a request with an API key (Issue #89).
 *
 * On success the key's owner is attached to `req.user` in the same shape
 * `requireAuth` uses, so downstream handlers work unchanged regardless of which
 * credential authenticated the caller.
 */
export const requireApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawKey = extractRawKey(req);

    if (!rawKey) {
      return handleError(req, res, AppError.authentication('Unauthorized: No API key provided'));
    }

    const { apiKey, user } = await apiKeyService.validateApiKey(rawKey);

    (req as any).apiKey = apiKey;
    (req as any).user = {
      id: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      walletAddress: user.walletAddress,
      emailVerified: user.emailVerified,
    };

    tieredApiKeyLimiter(req, res, () => {
      next();
    });
  } catch (error) {
    return handleError(req, res, error);
  }
};

export const requireApiKeyScope = (scope: ApiKeyScope) => {
  return (req: Request, res: Response, next: NextFunction) => {
    return requireApiKey(req, res, () => {
      const apiKey = (req as any).apiKey as ApiKey | undefined;
      if (!apiKey) {
        return handleError(req, res, AppError.authentication('Unauthorized: No API key provided'));
      }

      if (!apiKeyService.keyHasScope(apiKey, scope)) {
        return handleError(
          req,
          res,
          AppError.authorization(`Forbidden: API key missing required scope: ${scope}`),
        );
      }

      return next();
    });
  };
};

export const requireApiKeyPermission =
  (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
    return requireApiKey(req, res, () => {
      const apiKey = (req as any).apiKey as ApiKey | undefined;
      const user = (req as any).user;

      if (!apiKey || !user) {
        return handleError(req, res, AppError.authentication('Unauthorized: No API key provided'));
      }

      if (!apiKeyService.keyHasPermission(apiKey, user, permission)) {
        return handleError(
          req,
          res,
          AppError.authorization(`Forbidden: API key missing required permission: ${permission}`),
        );
      }

      return next();
    });
  };

export const requireAuthOrApiKey =
  (jwtMiddleware: (req: Request, res: Response, next: NextFunction) => void) =>
  (req: Request, res: Response, next: NextFunction) => {
    const hasApiKey = extractRawKey(req) !== undefined;

    if (hasApiKey) {
      return requireApiKey(req, res, next);
    }

    return jwtMiddleware(req, res, next);
  };
