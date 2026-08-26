import { Router } from 'express';
import { ReleaseController } from '../controllers/ReleaseController';
import { authArtistMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/', authArtistMiddleware, ReleaseController.create);
router.get('/', ReleaseController.list);
router.get('/:id', ReleaseController.getById);
router.put('/:id', authArtistMiddleware, ReleaseController.update);

export default router;
