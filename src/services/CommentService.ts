import { IsNull, Repository } from 'typeorm';
import {
  Comment,
  COMMENT_EDIT_WINDOW_MINUTES,
  COMMENT_MAX_DEPTH,
  COMMENT_MAX_LENGTH,
} from '../entities/Comment';
import { Song } from '../entities/Song';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import { validateStringLength, validateUUID } from '../validators/ServiceValidator';

/** Default page size for comment listings. */
const DEFAULT_COMMENT_LIMIT = 20;

/** Hard cap on page size so a caller cannot request an unbounded page. */
const MAX_COMMENT_LIMIT = 100;

/** A comment plus its reply count, as returned to clients. */
export interface CommentView {
  id: string;
  songId: string;
  userId: string;
  text: string;
  parentId?: string | null;
  depth: number;
  edited: boolean;
  replyCount: number;
  author: { id: string; username?: string; name?: string; profileImage?: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedComments {
  comments: CommentView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Service layer for song comments and replies (Issue #90).
 */
export class CommentService {
  private commentRepo: Repository<Comment>;
  private songRepo: Repository<Song>;

  constructor() {
    this.commentRepo = AppDataSource.getRepository(Comment);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Creates a comment on a song, or a reply to an existing comment.
   *
   * @param userId - Author of the comment
   * @param songId - Song being commented on
   * @param text - Comment body (1..{@link COMMENT_MAX_LENGTH} characters)
   * @param parentId - Optional comment being replied to
   * @returns The created comment view
   * @throws {AppError} When the song or parent is missing, the parent belongs to
   *   a different song, the text is invalid, or the depth limit is exceeded
   */
  async createComment(
    userId: string,
    songId: string,
    text: string,
    parentId?: string | null,
  ): Promise<CommentView> {
    validateUUID(userId, 'userId');
    validateUUID(songId, 'songId');
    validateStringLength(text, 'text', 1, COMMENT_MAX_LENGTH);

    const song = await this.songRepo.findOne({ where: { id: songId } });

    if (!song) {
      throw AppError.notFound(ERROR_MESSAGES.SONG_NOT_FOUND);
    }

    let depth = 1;

    if (parentId) {
      validateUUID(parentId, 'parentId');

      const parent = await this.commentRepo.findOne({ where: { id: parentId } });

      if (!parent) {
        throw AppError.notFound('Parent comment not found');
      }

      if (parent.songId !== songId) {
        throw AppError.validation('Parent comment belongs to a different song', {
          field: 'parentId',
          value: parentId,
        });
      }

      depth = parent.depth + 1;

      if (depth > COMMENT_MAX_DEPTH) {
        throw AppError.businessLogic(
          `Replies cannot be nested more than ${COMMENT_MAX_DEPTH} levels deep`,
          { field: 'parentId', value: parentId },
        );
      }
    }

    const comment = this.commentRepo.create({
      userId,
      songId,
      text: text.trim(),
      parentId: parentId ?? null,
      depth,
    });

    const saved = await this.commentRepo.save(comment);

    return this.toView(saved, 0);
  }

  /**
   * Lists a song's top-level comments with their reply counts.
   *
   * Only top-level comments are paginated; replies are fetched per comment via
   * {@link getReplies} so a comment with many replies cannot dominate a page.
   *
   * @param songId - Song whose comments are listed
   * @param page - 1-based page number
   * @param limit - Page size, capped at {@link MAX_COMMENT_LIMIT}
   * @returns Paginated comment views, newest first
   */
  async getSongComments(
    songId: string,
    page = 1,
    limit = DEFAULT_COMMENT_LIMIT,
  ): Promise<PaginatedComments> {
    validateUUID(songId, 'songId');

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || DEFAULT_COMMENT_LIMIT),
      MAX_COMMENT_LIMIT,
    );

    const [comments, total] = await this.commentRepo.findAndCount({
      where: { songId, parentId: IsNull() },
      relations: ['user'],
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const replyCounts = await this.countRepliesFor(comments.map((comment) => comment.id));

    return {
      comments: comments.map((comment) => this.toView(comment, replyCounts.get(comment.id) ?? 0)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Lists direct replies to a comment.
   *
   * @param commentId - Parent comment
   * @param page - 1-based page number
   * @param limit - Page size, capped at {@link MAX_COMMENT_LIMIT}
   * @returns Paginated reply views, oldest first so a thread reads in order
   */
  async getReplies(
    commentId: string,
    page = 1,
    limit = DEFAULT_COMMENT_LIMIT,
  ): Promise<PaginatedComments> {
    validateUUID(commentId, 'id');

    const parent = await this.commentRepo.findOne({ where: { id: commentId } });

    if (!parent) {
      throw AppError.notFound('Comment not found');
    }

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || DEFAULT_COMMENT_LIMIT),
      MAX_COMMENT_LIMIT,
    );

    const [replies, total] = await this.commentRepo.findAndCount({
      where: { parentId: commentId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const replyCounts = await this.countRepliesFor(replies.map((reply) => reply.id));

    return {
      comments: replies.map((reply) => this.toView(reply, replyCounts.get(reply.id) ?? 0)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Edits a comment the caller authored, within the edit window.
   *
   * @param userId - Caller, who must be the author
   * @param commentId - Comment to edit
   * @param text - Replacement body
   * @returns The updated comment view
   * @throws {AppError} When the comment is missing, the caller is not the
   *   author, or the edit window has closed
   */
  async updateComment(userId: string, commentId: string, text: string): Promise<CommentView> {
    validateUUID(userId, 'userId');
    validateUUID(commentId, 'id');
    validateStringLength(text, 'text', 1, COMMENT_MAX_LENGTH);

    const comment = await this.commentRepo.findOne({
      where: { id: commentId },
      relations: ['user'],
    });

    if (!comment) {
      throw AppError.notFound('Comment not found');
    }

    if (comment.userId !== userId) {
      throw AppError.authorization('You can only edit your own comments');
    }

    const windowMs = COMMENT_EDIT_WINDOW_MINUTES * 60 * 1000;
    const elapsedMs = Date.now() - new Date(comment.createdAt).getTime();

    if (elapsedMs > windowMs) {
      throw AppError.businessLogic(
        `Comments can only be edited within ${COMMENT_EDIT_WINDOW_MINUTES} minutes of posting`,
      );
    }

    comment.text = text.trim();
    comment.edited = true;

    const saved = await this.commentRepo.save(comment);
    const replyCount = await this.commentRepo.count({ where: { parentId: saved.id } });

    return this.toView(saved, replyCount);
  }

  /**
   * Deletes a comment the caller authored. Replies cascade with the parent.
   *
   * @param userId - Caller, who must be the author
   * @param commentId - Comment to delete
   * @throws {AppError} When the comment is missing or authored by someone else
   */
  async deleteComment(userId: string, commentId: string): Promise<void> {
    validateUUID(userId, 'userId');
    validateUUID(commentId, 'id');

    const comment = await this.commentRepo.findOne({ where: { id: commentId } });

    if (!comment) {
      throw AppError.notFound('Comment not found');
    }

    if (comment.userId !== userId) {
      throw AppError.authorization('You can only delete your own comments');
    }

    await this.commentRepo.remove(comment);
  }

  /**
   * Counts direct replies for many comments in one query, avoiding an N+1 count
   * per listed comment.
   *
   * @param parentIds - Comment ids to count replies for
   * @returns Map of comment id to direct reply count
   */
  private async countRepliesFor(parentIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    if (parentIds.length === 0) {
      return counts;
    }

    const rows = await this.commentRepo
      .createQueryBuilder('comment')
      .select('comment.parentId', 'parentId')
      .addSelect('COUNT(comment.id)', 'count')
      .where('comment.parentId IN (:...parentIds)', { parentIds })
      .groupBy('comment.parentId')
      .getRawMany<{ parentId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.parentId, Number(row.count));
    }

    return counts;
  }

  /** Maps an entity to its wire representation, exposing only public author fields. */
  private toView(comment: Comment, replyCount: number): CommentView {
    return {
      id: comment.id,
      songId: comment.songId,
      userId: comment.userId,
      text: comment.text,
      parentId: comment.parentId ?? null,
      depth: comment.depth,
      edited: comment.edited,
      replyCount,
      author: comment.user
        ? {
            id: comment.user.id,
            username: comment.user.username,
            name: comment.user.name,
            profileImage: comment.user.profileImage,
          }
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
