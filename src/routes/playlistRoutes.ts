import { Router } from 'express';
import { PlaylistController } from '../controllers/PlaylistController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// All playlist routes require authentication (Issue #77).
router.post('/', requireAuth, PlaylistController.create);
router.get('/', requireAuth, PlaylistController.list);
router.get('/:id', requireAuth, PlaylistController.getById);
router.put('/:id', requireAuth, PlaylistController.update);
router.delete('/:id', requireAuth, PlaylistController.remove);

// Song association + ordering.
router.post('/:id/songs', requireAuth, PlaylistController.addSong);
router.delete('/:id/songs/:songId', requireAuth, PlaylistController.removeSong);
router.put('/:id/reorder', requireAuth, PlaylistController.reorder);

export default router;
