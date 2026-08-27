import { Router } from 'express';
import { TagController } from '../controllers/TagController';

const router = Router();

router.get('/', TagController.listAll);
router.get('/:slug/songs', TagController.getSongsByTag);

export default router;
