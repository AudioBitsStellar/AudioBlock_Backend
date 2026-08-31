import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Comment } from '../entities/Comment';
import {
  CommentReport,
  CommentReportAction,
  CommentReportReason,
  CommentReportStatus,
} from '../entities/CommentReport';
import { AppError } from '../errors/AppError';
import logger from '../config/logger';

const VALID_REASONS = Object.values(CommentReportReason);
const VALID_ACTIONS = Object.values(CommentReportAction);

export interface SubmitCommentReportInput {
  reason: string;
  description?: string;
}

export interface ResolveCommentReportInput {
  actionTaken: string;
  resolutionNote?: string;
}

export interface PendingCommentReportsPage {
  reports: Array<CommentReport & { commentText?: string; songId?: string }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Community moderation of comments (Issue #411).
 *
 * Flagged comments surface in the moderation review queue used by the
 * `ReportService`. Each report carries the full comment context so a moderator
 * can assess it without leaving the queue. A `(commentId, reporterId)` unique
 * constraint guarantees one report per listener per comment, so duplicate
 * reports for the same comment and reporter are rejected.
 */
export class CommentReportService {
  private reportRepo: Repository<CommentReport>;
  private commentRepo: Repository<Comment>;

  constructor() {
    this.reportRepo = AppDataSource.getRepository(CommentReport);
    this.commentRepo = AppDataSource.getRepository(Comment);
  }

  /**
   * Submit a report against a comment, popping it into the moderation queue.
   *
   * @param commentId - ID of the flagged comment.
   * @param reporterId - ID of the reporting user.
   * @param input - Reason category and optional description.
   * @returns The created report with the comment context attached.
   * @throws {AppError} 400 for an unknown reason, 404 when the comment is
   *   missing, 409 when this user already reported this comment.
   */
  async submitReport(
    commentId: string,
    reporterId: string,
    input: SubmitCommentReportInput,
  ): Promise<CommentReport> {
    const reason = this.parseReason(input.reason);

    const comment = await this.commentRepo.findOneBy({ id: commentId });
    if (!comment) {
      throw AppError.notFound('Comment not found', undefined, 'COMMENT_NOT_FOUND');
    }

    const existing = await this.reportRepo.findOne({ where: { commentId, reporterId } });
    if (existing) {
      throw AppError.conflict(
        'You have already reported this comment',
        undefined,
        'DUPLICATE_COMMENT_REPORT',
      );
    }

    const report = this.reportRepo.create({
      commentId,
      reporterId,
      reason,
      description: input.description?.trim() || null,
      status: CommentReportStatus.PENDING,
    });
    await this.reportRepo.save(report);

    logger.info(
      { commentId, reporterId, reason },
      'Comment flagged and added to the moderation queue',
    );

    return report;
  }

  /**
   * Paginated queue of unresolved comment reports, with the full comment
   * context (text and owning song) attached so moderators can review inline.
   *
   * @param page - 1-based page number.
   * @param limit - Page size, capped at 100.
   */
  async listPendingReports(page = 1, limit = 20): Promise<PendingCommentReportsPage> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), 100);

    const [reports, total] = await this.reportRepo.findAndCount({
      where: { status: CommentReportStatus.PENDING },
      relations: { comment: true },
      order: { createdAt: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const enriched = reports.map((report) => {
      const flat = report as CommentReport & { commentText?: string; songId?: string };
      flat.commentText = report.comment?.text;
      flat.songId = report.comment?.songId;
      return flat;
    });

    return {
      reports: enriched,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 0,
      },
    };
  }

  /**
   * Count of pending reports for a comment, used by moderation views.
   */
  async countPendingForComment(commentId: string): Promise<number> {
    return this.reportRepo.count({ where: { commentId, status: CommentReportStatus.PENDING } });
  }

  /**
   * Resolve a pending comment report, recording the action a moderator took.
   *
   * `comment_flagged` and `comment_removed` mark the comment as flagged so it
   * is hidden from public views; `dismissed` / `no_action` leave it as-is.
   *
   * @param reportId - ID of the comment report to resolve.
   * @param moderatorId - ID of the resolving moderator.
   * @param input - Action taken plus an optional note.
   * @throws {AppError} 400 for an unknown action, 404 when the report does not
   *   exist, 409 when it was already resolved.
   */
  async resolveReport(
    reportId: string,
    moderatorId: string,
    input: ResolveCommentReportInput,
  ): Promise<CommentReport> {
    const action = this.parseAction(input.actionTaken);

    const report = await this.reportRepo.findOneBy({ id: reportId });
    if (!report) {
      throw AppError.notFound('Comment report not found', undefined, 'COMMENT_REPORT_NOT_FOUND');
    }
    if (report.status === CommentReportStatus.RESOLVED) {
      throw AppError.conflict(
        'Comment report is already resolved',
        undefined,
        'COMMENT_REPORT_ALREADY_RESOLVED',
      );
    }

    report.status = CommentReportStatus.RESOLVED;
    report.actionTaken = action;
    report.resolvedBy = moderatorId;
    report.resolvedAt = new Date();
    report.resolutionNote = input.resolutionNote?.trim() || null;
    await this.reportRepo.save(report);

    if (action === CommentReportAction.COMMENT_FLAGGED || action === CommentReportAction.COMMENT_REMOVED) {
      const comment = await this.commentRepo.findOneBy({ id: report.commentId });
      if (comment) {
        comment.flagged = true;
        comment.flaggedAt = new Date();
        comment.flagReason = `Comment report resolution: ${action}`;
        await this.commentRepo.save(comment);
      }
    }

    return report;
  }

  private parseReason(raw: string): CommentReportReason {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!VALID_REASONS.includes(value as CommentReportReason)) {
      throw AppError.validation(
        `reason must be one of: ${VALID_REASONS.join(', ')}`,
        { field: 'reason', value: raw },
        'INVALID_COMMENT_REPORT_REASON',
      );
    }
    return value as CommentReportReason;
  }

  private parseAction(raw: string): CommentReportAction {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!VALID_ACTIONS.includes(value as CommentReportAction)) {
      throw AppError.validation(
        `actionTaken must be one of: ${VALID_ACTIONS.join(', ')}`,
        { field: 'actionTaken', value: raw },
        'INVALID_COMMENT_REPORT_ACTION',
      );
    }
    return value as CommentReportAction;
  }
}
