import { Router } from 'express';
import { TakedownController } from '../controllers/TakedownController';
import { requireAuth, requireRoles } from '../middlewares/authMiddleware';
import { UserRole } from '../entities/User';
import { validateDTO } from '../middlewares/validate';
import {
  CounterNoticeTakedownDTO,
  CreateTakedownRequestDTO,
  ReviewTakedownRequestDTO,
} from '../dtos/TakedownRequestDTO';

const router = Router();

// Any authenticated user can file a takedown request
router.post(
  '/request',
  requireAuth,
  validateDTO(CreateTakedownRequestDTO),
  TakedownController.create,
);

// Public: takedown policy and DMCA agent details (#986). Registered before the
// admin `/:id` route below, otherwise "policy" would be matched as an id.
router.get('/policy', TakedownController.getPolicy);

// Admin-only: list, get, review
router.get('/', requireRoles(UserRole.ADMIN), TakedownController.list);
router.get('/:id', requireRoles(UserRole.ADMIN), TakedownController.getOne);
router.patch(
  '/:id/review',
  requireRoles(UserRole.ADMIN),
  validateDTO(ReviewTakedownRequestDTO),
  TakedownController.review,
);

export default router;
