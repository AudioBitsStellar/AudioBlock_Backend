import { Request, Response } from 'express';
import { JwtPayload } from '../middlewares/authMiddleware';
import { AccountSuspensionService } from '../services/AccountSuspensionService';
import { AdminAuditService } from '../services/AdminAuditService';
import { AdminModerationService } from '../services/AdminModerationService';
import { SuspendAccountDTO } from '../dtos/SuspendAccountDTO';
import { AppError } from '../errors/AppError';
import { HTTP_STATUS } from '../config/constants';
import { handleError } from '../utils/helpers';
import { parsePagination } from '../utils/pagination';
import { routeParam } from '../utils/routeParams';
import { validateUUID } from '../validators/ServiceValidator';

/**
 * Account restriction, comment removal and the admin audit log (#980).
 *
 * Every mutating call here is also written to the audit log by
 * `adminAuditMiddleware`, so these handlers only need to do the work.
 */
export class AdminModerationController {
  /** POST /api/admin/users/:id/suspend — suspend or ban an account. */
  static suspendUser = async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as JwtPayload | undefined;
      if (!actor?.id) {
        return handleError(req, res, AppError.authentication('Admin not authenticated'));
      }

      const body = req.body as SuspendAccountDTO;
      const state = await AccountSuspensionService.suspend(
        { id: actor.id, role: actor.role },
        routeParam(req.params.id),
        { type: body.type, reason: body.reason },
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Account restricted',
        data: state,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** POST /api/admin/users/:id/reinstate — lift a suspension or ban. */
  static reinstateUser = async (req: Request, res: Response) => {
    try {
      await AccountSuspensionService.reinstate(routeParam(req.params.id));

      return res.status(HTTP_STATUS.OK).json({ success: true, message: 'Account reinstated' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/admin/comments/:id — remove a comment whatever its author. */
  static removeComment = async (req: Request, res: Response) => {
    try {
      await AdminModerationService.removeComment(routeParam(req.params.id));

      return res.status(HTTP_STATUS.OK).json({ success: true, message: 'Comment removed' });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/admin/audit-logs — paginated admin actions, newest first. */
  static listAuditLogs = async (req: Request, res: Response) => {
    try {
      const pagination = parsePagination(req.query as Record<string, unknown>);
      const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
      if (actorId !== undefined) {
        validateUUID(actorId, 'actorId');
      }

      const result = await AdminAuditService.list({ ...pagination, actorId });

      return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
