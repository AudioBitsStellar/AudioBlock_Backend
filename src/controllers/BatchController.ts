import { Request, Response } from 'express';
import { Application } from 'express';
import { BatchRequestItem, BatchResponseItem } from '../types/BatchTypes';
import { BatchService } from '../services/BatchService';
import logger from '../config/logger';
import { AppError, ErrorType } from '../errors/AppError';
import { handleError } from '../utils/helpers';

const MAX_BATCH_SIZE = 10;
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

export class BatchController {
  private service: BatchService;

  constructor(app: Application) {
    this.service = new BatchService(app);
  }

  handle = async (req: Request, res: Response): Promise<void> => {
    try {
      const rawSize =
        parseInt(req.headers['content-length'] as string, 10) ||
        Buffer.byteLength(JSON.stringify(req.body), 'utf8');

      if (rawSize > MAX_BODY_BYTES) {
        throw new AppError(
          'Request body exceeds 100KB batch limit',
          ErrorType.VALIDATION_FAILED,
          413,
          true,
          undefined,
          'PAYLOAD_TOO_LARGE',
        );
      }

      const items: unknown[] = req.body;

      if (!Array.isArray(items)) {
        throw AppError.validation('Request body must be an array of { method, path, body? }');
      }

      if (items.length === 0) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      if (items.length > MAX_BATCH_SIZE) {
        throw AppError.validation(`Batch limited to ${MAX_BATCH_SIZE} sub-requests`);
      }

      const parentHeaders = req.headers as Record<string, string | string[] | undefined>;

      const results: BatchResponseItem[] = await Promise.all(
        items.map(async (item, index) => {
          if (!item || typeof item !== 'object') {
            return {
              status: 400,
              body: {
                error: {
                  code: 'INVALID_SUBREQUEST',
                  message: 'Invalid sub-request: must be an object',
                },
              },
            };
          }

          const { method, path, body } = item as BatchRequestItem;

          if (!method || !path) {
            return {
              status: 400,
              body: {
                error: {
                  code: 'MISSING_FIELDS',
                  message: 'Each sub-request requires method and path',
                },
              },
            };
          }

          const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
          if (!allowed.includes(method.toUpperCase())) {
            return {
              status: 400,
              body: {
                error: { code: 'UNSUPPORTED_METHOD', message: `Unsupported method: ${method}` },
              },
            };
          }

          logger.debug({ index, method, path }, 'Processing batch sub-request');

          try {
            return await this.service.dispatch({ method, path, body }, parentHeaders);
          } catch (err) {
            logger.error({ index, method, path, err }, 'Sub-request failed unexpectedly');
            return {
              status: 500,
              body: { error: { code: 'INTERNAL_ERROR', message: 'Internal sub-request error' } },
            };
          }
        }),
      );

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      logger.error({ err }, 'Batch endpoint error');
      handleError(res, err);
    }
  };
}
