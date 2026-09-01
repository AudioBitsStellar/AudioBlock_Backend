import { Router } from 'express';
import { FanPerkController } from '../controllers/FanPerkController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
const controller = new FanPerkController();

// Public: list visible perks for an artist
router.get('/artists/:artistId/perks', controller.listPerks);

// Artist: list own perks (including hidden)
router.get('/artists/me/perks', requireAuth, controller.listMyPerks);

// Artist: create a perk
router.post('/artists/me/perks', requireAuth, controller.createPerk);

// Artist: update a perk
router.put('/artists/me/perks/:id', requireAuth, controller.updatePerk);

// Artist: delete a perk
router.delete('/artists/me/perks/:id', requireAuth, controller.deletePerk);

export default router;
