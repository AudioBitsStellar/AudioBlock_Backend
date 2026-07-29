import { Request, Response } from 'express';
import { UserService } from '../services/UserService';
import { ReportService } from '../services/ReportService';
import { SongModerationService } from '../services/Song/SongModerationService';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';

/**
 * Admin-facing user & role management (Issue #100), bulk song moderation
 * (Issue #85), and the content report queue (Issue #88).
 */
export class AdminController {
  private static userService = new UserService();
  private static reportService = new ReportService();
  private static moderationService = new SongModerationService();

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
   * POST /api/admin/songs/moderate — apply one action to a batch of songs
   * (Issue #85).
   *
   * Responds 200 with a per-song result list. Individual failures are reported
   * in `results` rather than failing the whole request; a request is only
   * rejected outright for an invalid action or an oversized batch.
   */
  static bulkModerateSongs = async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user.id as string;
      const { songIds, action } = req.body;

      const result = await AdminController.moderationService.bulkModerate(songIds, action, adminId);

      return res.status(HTTP_STATUS.OK).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/admin/reports — pending content report queue (Issue #88). */
  static listReports = async (req: Request, res: Response) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const songId = req.query.songId as string | undefined;

      const result = await AdminController.reportService.listPendingReports(page, limit, songId);

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result.reports,
        pagination: result.pagination,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/admin/reports/:id/resolve — resolve a report (Issue #88). */
  static resolveReport = async (req: Request, res: Response) => {
    try {
      const reportId = req.params.id as string;
      const moderatorId = (req as any).user.id as string;
      const { actionTaken, resolutionNote } = req.body;

      const report = await AdminController.reportService.resolveReport(reportId, moderatorId, {
        actionTaken,
        resolutionNote,
      });

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Report resolved',
        data: report,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
