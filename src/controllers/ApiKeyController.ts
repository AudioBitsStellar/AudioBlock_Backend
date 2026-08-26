import { Request, Response } from 'express';
import { ApiKeyService } from '../services/ApiKeyService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';

/**
 * Controller for API key management endpoints (Issue #89).
 * All routes are JWT-authenticated — a key cannot be used to mint more keys.
 */
export class ApiKeyController {
  private apiKeyService: ApiKeyService;

  constructor() {
    this.apiKeyService = new ApiKeyService();
  }

  /**
   * Issue a new API key.
   * POST /api/api-keys
   *
   * The raw key appears in this response only and cannot be retrieved later.
   */
  createApiKey = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const { name, permissions } = req.body;

      const created = await this.apiKeyService.createApiKey(userId, name, permissions ?? []);

      res.status(HTTP_STATUS.CREATED).json({
        message: 'API key created. Store it now — it will not be shown again.',
        apiKey: created,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * List the caller's API keys. Raw keys and hashes are never returned.
   * GET /api/api-keys?includeRevoked=true
   */
  listApiKeys = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const includeRevoked = req.query.includeRevoked === 'true';
      const apiKeys = await this.apiKeyService.listApiKeys(userId, includeRevoked);

      res.status(HTTP_STATUS.OK).json({ apiKeys, total: apiKeys.length });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Revoke one of the caller's API keys.
   * DELETE /api/api-keys/:id
   */
  revokeApiKey = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const apiKey = await this.apiKeyService.revokeApiKey(userId, routeParam(req.params.id));

      res.status(HTTP_STATUS.OK).json({ message: 'API key revoked successfully', apiKey });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
