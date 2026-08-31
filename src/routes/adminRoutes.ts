import { Router } from 'express';
import { requirePermission } from '../middlewares/authMiddleware';
import { Permission } from '../types/Permissions';
import { validateDTO } from '../middlewares/validate';
import { AssignRoleDTO } from '../dtos/AssignRoleDTO';
import { RejectVerificationDTO } from '../dtos/RejectVerificationDTO';
import { SongController } from '../controllers/SongController';
import { JobController } from '../controllers/JobController';
import { AdminController } from '../controllers/AdminController';
import { bulkModerationRateLimiter } from '../middlewares/bulkModerationRateLimiter';

const router = Router();

// RBAC (Issue #100): each route requires the specific permission it needs
// rather than a blanket admin check. requirePermission returns 401 when the
// caller is unauthenticated and 403 when the role lacks the permission.

// Content moderation — moderators and above.
router.patch(
  '/song/:id/flag',
  requirePermission(Permission.CONTENT_MODERATE),
  SongController.flagSong,
);
router.patch(
  '/song/:id/unflag',
  requirePermission(Permission.CONTENT_MODERATE),
  SongController.unflagSong,
);

// Manual retry for failed song processing (Issues #123, #125)
router.post(
  '/songs/:id/retry',
  requirePermission(Permission.CONTENT_MODERATE),
  SongController.retryFailedSong,
);
router.post(
  '/song/:id/retry',
  requirePermission(Permission.CONTENT_MODERATE),
  SongController.retryFailedSong,
);

// Bulk song moderation (Issue #85) — admins only, rate limited to 5 bulk
// operations per minute per admin. The limiter runs after the permission check
// so unauthorized callers never consume an admin's budget.
router.post(
  '/songs/moderate',
  requirePermission(Permission.CONTENT_MODERATE_BULK),
  bulkModerationRateLimiter,
  validateDTO(BulkModerateSongsDTO),
  AdminController.bulkModerateSongs,
);

// Content report queue (Issue #88) — moderators and above.
router.get('/reports', requirePermission(Permission.CONTENT_MODERATE), AdminController.listReports);
router.put(
  '/reports/:id/resolve',
  requirePermission(Permission.CONTENT_MODERATE),
  validateDTO(ResolveReportDTO),
  AdminController.resolveReport,
);

// Search index maintenance (Issue #135)
router.post(
  '/search/rebuild',
  requirePermission(Permission.SEARCH_MANAGE),
  SongController.rebuildSearchIndex,
);

// Background job queue visibility (Issue #132)
router.get('/jobs', requirePermission(Permission.JOBS_VIEW), JobController.getJobs);
router.get('/jobs/:id', requirePermission(Permission.JOBS_VIEW), JobController.getJob);

// Role assignment (Issue #100) — admins and super_admins only.
router.post(
  '/users/:id/role',
  requirePermission(Permission.ROLE_ASSIGN),
  validateDTO(AssignRoleDTO),
  AdminController.assignRole,
);

// Artist verification review (Issue #92) — moderators and above.
router.get(
  '/verifications',
  requirePermission(Permission.VERIFICATION_REVIEW),
  AdminController.listVerifications,
);
router.put(
  '/verifications/:id/approve',
  requirePermission(Permission.VERIFICATION_REVIEW),
  AdminController.approveVerification,
);
router.put(
  '/verifications/:id/reject',
  requirePermission(Permission.VERIFICATION_REVIEW),
  validateDTO(RejectVerificationDTO),
  AdminController.rejectVerification,
);

// Transaction logs visibility (Issue #39)
router.get(
  '/transaction-logs',
  requirePermission(Permission.TRANSACTION_LOGS_VIEW),
  AdminController.getTransactionLogs,
);

// Indexer health/status (Issue #253) — admins and moderators.
router.get(
  '/indexer/status',
  requirePermission(Permission.CONTENT_MODERATE),
  AdminController.getIndexerStatus,
);

export default router;
