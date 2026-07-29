import { Router } from 'express';
import { requireRoles, requirePermission } from '../middlewares/authMiddleware';
import { UserRole } from '../entities/User';
import { SongController } from '../controllers/SongController';
import { JobController } from '../controllers/JobController';
import { AdminController } from '../controllers/AdminController';
import { validateDTO } from '../middlewares/validate';
import { AssignRoleDTO } from '../dtos/AssignRoleDTO';
import { Permission } from '../types/permissions';

const router = Router();
const adminController = new AdminController();

router.use(requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN));

// Role assignment - requires SUPER_ADMIN or explicit ASSIGN_ROLE permission
router.post(
  '/users/:id/role',
  requirePermission(Permission.ASSIGN_ROLE),
  validateDTO(AssignRoleDTO),
  adminController.assignRole,
);

router.patch('/song/:id/flag', SongController.flagSong);
router.patch('/song/:id/unflag', SongController.unflagSong);

// Manual retry for failed song processing (Issues #123, #125)
router.post('/songs/:id/retry', SongController.retryFailedSong);
router.post('/song/:id/retry', SongController.retryFailedSong);

// Search index maintenance (Issue #135)
router.post('/search/rebuild', SongController.rebuildSearchIndex);

// Background job queue visibility (Issue #132)
router.get('/jobs', JobController.getJobs);
router.get('/jobs/:id', JobController.getJob);

export default router;
