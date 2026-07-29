import { Request, Response } from 'express';
import { AdminService } from '../services/AdminService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';

/**
 * Controller for administrative actions.
 * All endpoints require appropriate admin-level permissions.
 */
export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = new AdminService();
  }

  /**
   * Assign a role to a user.
   * POST /api/admin/users/:id/role
   *
   * @param req - Express request with user ID in params and role in body
   * @param res - Express response
   */
  assignRole = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { role } = req.body;

      const updatedUser = await this.adminService.assignRole(userId, role);

      res.status(HTTP_STATUS.OK).json({
        message: 'Role assigned successfully',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          username: updatedUser.username,
          role: updatedUser.role,
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
