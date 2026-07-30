import { Request, Response } from 'express';
import { UserService } from '../services/UserService';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';
import { VerificationStatus } from '../entities/ArtistVerification';

/**
 * Admin-facing user & role management (Issue #100) and artist verification
 * review (Issue #92).
 */
export class AdminController {
  private static userService = new UserService();
  private static artistProfileService = new ArtistProfileService();

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
}
