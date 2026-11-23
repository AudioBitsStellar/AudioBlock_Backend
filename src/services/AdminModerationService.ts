import AppDataSource from '../config/db';
import { Comment } from '../entities/Comment';
import { AppError } from '../errors/AppError';

/** Content removal carried out by moderators and admins (#980). */
export class AdminModerationService {
  /**
   * Remove a comment regardless of its author. Replies are removed with it by
   * the database cascade. The removal is recorded by the admin audit middleware.
   *
   * @throws {AppError} 404 when the comment does not exist.
   */
  static async removeComment(commentId: string): Promise<void> {
    const repo = AppDataSource.getRepository(Comment);
    const comment = await repo.findOne({ where: { id: commentId } });
    if (!comment) {
      throw AppError.notFound('Comment not found', undefined, 'COMMENT_NOT_FOUND');
    }
    await repo.remove(comment);
  }
}
