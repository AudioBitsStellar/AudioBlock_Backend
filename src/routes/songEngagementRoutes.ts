import { Router } from 'express';
import { SaveController } from '../controllers/SaveController';
import { CommentController } from '../controllers/CommentController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { SaveSongDTO } from '../dtos/SaveSongDTO';
import { CreateCommentDTO } from '../dtos/CreateCommentDTO';

/**
 * Per-song engagement routes mounted at /api/songs (Issues #90, #91).
 *
 * Kept separate from SongRoutes (mounted at /api/song) so the paths named in
 * the issues — /api/songs/:id/save and /api/songs/:id/comments — are served
 * exactly, without disturbing the existing singular upload/stream routes.
 */
const router = Router();
const saveController = new SaveController();
const commentController = new CommentController();

// Saves/bookmarks (Issue #91)
router.post('/:id/save', requireAuth, validateDTO(SaveSongDTO), saveController.saveSong);
router.delete('/:id/save', requireAuth, saveController.unsaveSong);
router.get('/:id/save', requireAuth, saveController.getSaveStatus);

// Comments (Issue #90) — reading is public, posting requires a token.
router.get('/:id/comments', commentController.getSongComments);
router.post(
  '/:id/comments',
  requireAuth,
  validateDTO(CreateCommentDTO),
  commentController.createComment,
);

export default router;
