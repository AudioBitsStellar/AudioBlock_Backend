import { Router } from 'express';
import { ActivityController } from '../controllers/ActivityController';
import { requireAuth, optionalAuth } from '../middlewares/authMiddleware';

const router = Router();

router.get('/onchain', ActivityController.getOnChainActivity);
// Overview feed: `?artistId=` (aliases artist/artist_id/userId/user_id) scopes to
// artist-authored + owned-song + follow activity (Issue #846). `?mode=following`
// still scopes to the caller's follows; `?type=` filters actionType on the artist path.
router.get('/', optionalAuth, ActivityController.getActivityFeed);
router.get('/feed/me', requireAuth, ActivityController.getMyFeed);
router.get('/users/:id/activities', ActivityController.getUserActivities);

export default router;
