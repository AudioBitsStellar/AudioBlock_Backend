import { Router } from 'express';
import { RoyaltyPayoutController } from '../controllers/RoyaltyPayoutController';
import { authArtistMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Export history for the authenticated artist
router.get('/export', authArtistMiddleware, RoyaltyPayoutController.exportHistory);

export default router;
