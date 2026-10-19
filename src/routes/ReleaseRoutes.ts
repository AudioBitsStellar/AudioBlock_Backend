import { Router } from 'express';
import { ReleaseController } from '../controllers/ReleaseController';
import { authArtistMiddleware, requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.post('/', authArtistMiddleware, ReleaseController.create);
router.get('/', ReleaseController.list);
router.get('/:id', ReleaseController.getById);
router.put('/:id', authArtistMiddleware, ReleaseController.update);

// Pre-save campaigns for upcoming releases (Issue #424). Static paths must be
// registered before `/:id/presave` siblings only when they collide; `:id`
// routes above remain first so `/:id/presave` never shadows them.
router.post('/:id/publish', authArtistMiddleware, ReleaseController.publish);
router.post('/:id/presave', requireAuth, ReleaseController.preSave);
router.delete('/:id/presave', requireAuth, ReleaseController.unPreSave);
router.get('/:id/presave', requireAuth, ReleaseController.getPreSaveStatus);

export default router;
