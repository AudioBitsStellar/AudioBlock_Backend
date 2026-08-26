import { Router } from 'express';
import { RoyaltyTemplateController } from '../controllers/RoyaltyTemplateController';
import { requireAuth } from '../middlewares/authMiddleware';

const controller = new RoyaltyTemplateController();
const router = Router();

router.use(requireAuth);

router.post('/', controller.create);
router.get('/', controller.list);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);

export default router;
