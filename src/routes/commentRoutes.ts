import { Router } from 'express';
import { CommentController } from '../controllers/CommentController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { UpdateCommentDTO } from '../dtos/UpdateCommentDTO';

const router = Router();
const commentController = new CommentController();

// Reading a thread is public; mutating a comment requires the author's token.
router.get('/:id/replies', commentController.getReplies);
router.put('/:id', requireAuth, validateDTO(UpdateCommentDTO), commentController.updateComment);
router.delete('/:id', requireAuth, commentController.deleteComment);

export default router;
