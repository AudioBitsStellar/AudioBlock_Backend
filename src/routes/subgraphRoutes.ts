import { Router } from 'express';
import { SubgraphController } from '../controllers/SubgraphController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.use(requireAuth);
router.get('/health', SubgraphController.health);
router.get('/aggregate', SubgraphController.aggregate);
router.get('/artists', SubgraphController.artists);
router.get('/artists/:artistId', SubgraphController.artist);
router.get('/songs', SubgraphController.songs);
router.get('/songs/:songId/engagement', SubgraphController.trackEngagement);
router.get('/sales', SubgraphController.sales);
router.get('/transfers', SubgraphController.transfers);
router.get('/mints', SubgraphController.mints);

export default router;
