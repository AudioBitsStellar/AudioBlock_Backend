import { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { CommentReaction, ReactionType } from '../entities/CommentReaction';
import { Comment } from '../entities/Comment';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

/**
 * Controller for comment reactions (Issue #412).
 *
 * Supports like/heart/fire reactions. Each user may have at most one reaction
 * per type per comment — toggling the same type removes it.
 */
export class CommentReactionController {
  /**
   * List reactions for a comment.
   * GET /api/comments/:id/reactions
   */
  getReactions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const reactionRepo = AppDataSource.getRepository(CommentReaction);
      const reactions = await reactionRepo.find({
        where: { commentId: id },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      });

      // Group by type with counts
      const grouped = Object.values(ReactionType).map((type) => {
        const ofType = reactions.filter((r) => r.type === type);
        return {
          type,
          count: ofType.length,
          users: ofType.map((r) => ({ id: r.userId, reactedAt: r.createdAt })),
        };
      });

      res.json({ reactions: grouped });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Toggle a reaction on a comment. Adds if absent, removes if present.
   * POST /api/comments/:id/reactions
   * Body: { type: "like" | "heart" | "fire" }
   */
  toggleReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return handleError(req, res, AppError.authentication('User not authenticated'));
      }

      const { id } = req.params;
      const { type } = req.body;

      if (!type || !Object.values(ReactionType).includes(type)) {
        return handleError(req, res, AppError.badRequest('Invalid reaction type'));
      }

      const reactionRepo = AppDataSource.getRepository(CommentReaction);
      const commentRepo = AppDataSource.getRepository(Comment);

      // Verify comment exists
      const comment = await commentRepo.findOneBy({ id });
      if (!comment) {
        return handleError(req, res, AppError.notFound('Comment not found'));
      }

      // Check if user already reacted with this type
      const existing = await reactionRepo.findOneBy({
        userId,
        commentId: id,
        type: type as ReactionType,
      });

      if (existing) {
        // Toggle off
        await reactionRepo.remove(existing);
        res.json({ removed: true, type });
      } else {
        // Add reaction
        const reaction = reactionRepo.create({
          userId,
          commentId: id,
          type: type as ReactionType,
        });
        await reactionRepo.save(reaction);
        res.json({ added: true, type, id: reaction.id });
      }
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
