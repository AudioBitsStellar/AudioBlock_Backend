import { plainToInstance } from 'class-transformer';
import { Request, Response } from 'express';
import { validate } from 'class-validator';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import { RequestAccountDeletionDTO } from '../dtos/AccountDeletionDTO';
import { AccountDeletionService } from '../services/AccountDeletionService';

/** Turn class-validator errors into the standard `{ field, message }` detail shape. */
function toValidationDetails(errors: { property: string; constraints?: Record<string, string> }[]) {
  return errors.map((err) => ({
    field: err.property,
    message: Object.values(err.constraints || {})[0] ?? 'Invalid value',
  }));
}

/**
 * Self-service account lifecycle endpoints (Issue #633).
 *
 * These are the user-facing side of GDPR Articles 12, 15, 17 and 20. Every route
 * is scoped to the *authenticated* user — there is no path parameter for a user
 * id, so none of these can be pointed at someone else's account by mistake or by
 * a crafted request.
 */
export class AccountController {
  private service: AccountDeletionService;

  constructor(service: AccountDeletionService = new AccountDeletionService()) {
    this.service = service;
  }

  /**
   * `GET /api/account/data` — full portability export of the caller's data
   * (Art. 15, 20). Deliberately a GET returning JSON: the caller chooses how to
   * store it, and streaming a file would pin a delivery format.
   */
  exportData = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw AppError.authentication('Unauthorized');
      }

      const data = await this.service.exportUserData(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * `POST /api/account/deletion-request` — schedule erasure after a grace window
   * (Art. 17). Returns the reference id and the scheduled date so the user knows
   * exactly when the irreversible step happens and can cancel before it.
   */
  requestDeletion = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw AppError.authentication('Unauthorized');
      }

      const dto = plainToInstance(RequestAccountDeletionDTO, req.body ?? {}, {
        enableImplicitConversion: true,
      });
      const errors = await validate(dto);
      if (errors.length > 0) {
        throw AppError.validation('Validation failed', toValidationDetails(errors));
      }

      if (dto.confirm !== true) {
        throw AppError.validation('Deletion must be explicitly confirmed: set "confirm" to true', {
          field: 'confirm',
        });
      }

      const result = await this.service.requestDeletion(userId, dto.reason);

      res.status(202).json({
        success: true,
        message:
          'Account deletion scheduled. Export your data before the scheduled date if you want a copy, ' +
          'and you can cancel any time before then.',
        ...result,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * `DELETE /api/account/deletion-request` — cancel a pending request, restoring
   * normal access to the account.
   */
  cancelDeletion = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw AppError.authentication('Unauthorized');
      }

      await this.service.cancelDeletion(userId);
      res.status(200).json({ success: true, message: 'Account deletion request cancelled' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** `GET /api/account/deletion-status` — where the request stands. */
  getDeletionStatus = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw AppError.authentication('Unauthorized');
      }

      const status = await this.service.getStatus(userId);
      res.status(200).json({ success: true, ...status });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
