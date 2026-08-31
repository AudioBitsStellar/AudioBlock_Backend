import { Request, Response } from 'express';
import { UserService } from '../services/UserService';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';
import { VerificationStatus } from '../entities/ArtistVerification';
import { TransactionLogService } from '../services/TransactionLogService';

/**
 * Admin-facing user & role management (Issue #100) and artist verification
 * review (Issue #92).
 */
export class AdminController {
  private static userService = new UserService();
  private static artistProfileService = new ArtistProfileService();
  private static transactionLogService = new TransactionLogService();
  private static indexerService = new (require('../services/IndexerService').IndexerService)();

  /**
   * POST /api/admin/users/:id/role — assign a role to a user.
   *
   * Authorization is enforced by the route (admin-only). The request body is
   * validated against {@link AssignRoleDTO} so `role` is always a valid
   * {@link UserRole}.
   */
  static assignRole = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { role } = req.body;

      const user = await AdminController.userService.assignRole(id, role);

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Role assigned successfully',
        id: user.id,
        role: user.role,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * GET /api/admin/verifications — list verification applications (Issue #92).
   *
   * Defaults to the pending queue; `?status=approved|rejected` inspects history.
   */
  static listVerifications = async (req: Request, res: Response) => {
    try {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;

      if (
        statusParam &&
        !Object.values(VerificationStatus).includes(statusParam as VerificationStatus)
      ) {
        return handleError(
          req,
          res,
          AppError.validation(
            `status must be one of: ${Object.values(VerificationStatus).join(', ')}`,
            { field: 'status', value: statusParam },
          ),
        );
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await AdminController.artistProfileService.listVerifications(
        (statusParam as VerificationStatus) ?? VerificationStatus.PENDING,
        page,
        limit,
      );

      return res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * PUT /api/admin/verifications/:id/approve — grant a verification badge
   * (Issue #92).
   */
  static approveVerification = async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user?.id;

      if (!adminId) {
        return handleError(req, res, AppError.authentication('Admin not authenticated'));
      }

      const verification = await AdminController.artistProfileService.approveVerification(
        routeParam(req.params.id),
        adminId,
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Verification approved successfully',
        verification,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * PUT /api/admin/verifications/:id/reject — decline an application with a
   * reason the applicant can act on (Issue #92).
   */
  static rejectVerification = async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user?.id;

      if (!adminId) {
        return handleError(req, res, AppError.authentication('Admin not authenticated'));
      }

      const verification = await AdminController.artistProfileService.rejectVerification(
        routeParam(req.params.id),
        adminId,
        req.body.reason,
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Verification rejected',
        verification,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * GET /api/admin/transaction-logs — list transaction logs (Issue #39).
   */
  static getTransactionLogs = async (req: Request, res: Response) => {
    try {
      const filters = {
        userId: req.query.userId as string,
        status: req.query.status as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      };

      const result = await AdminController.transactionLogService.getAdminLogs(filters);

      return res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * GET /api/admin/indexer/status — get indexer health per contract/network (Issue #253).
   *
   * Returns cursor position, lag, event count, and last error for all contracts.
   * Admin-gated via requirePermission middleware.
   */
  static getIndexerStatus = async (req: Request, res: Response) => {
    try {
      const currentLedgerParam = req.query.currentLedger as string | undefined;
      const currentLedger = currentLedgerParam ? Number(currentLedgerParam) : undefined;

      const statuses = await AdminController.indexerService.getAllStatus(currentLedger);
      const backfillStatuses = await AdminController.indexerService.getAllBackfillStatus();

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        indexers: statuses,
        backfills: backfillStatuses,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
