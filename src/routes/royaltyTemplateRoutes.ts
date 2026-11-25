import { Router } from 'express';
import { RoyaltyTemplateController } from '../controllers/RoyaltyTemplateController';
import { authArtistMiddleware } from '../middlewares/authMiddleware';

const controller = new RoyaltyTemplateController();
const router = Router();

router.use(authArtistMiddleware);

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.get);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);

export default router;
