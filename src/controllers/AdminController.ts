import { Request, Response } from 'express';
import { UserService } from '../services/UserService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';

/**
 * Admin-facing user & role management (Issue #100).
 */
export class AdminController {
  private static userService = new UserService();

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
}
