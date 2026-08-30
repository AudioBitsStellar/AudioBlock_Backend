import { Router } from 'express';
import { CommentReactionController } from '../controllers/CommentReactionController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
const controller = new CommentReactionController();

// List reactions for a comment (public)
router.get('/:id/reactions', controller.getReactions);

// Toggle a reaction (authenticated)
router.post('/:id/reactions', requireAuth, controller.toggleReaction);

export default router;
