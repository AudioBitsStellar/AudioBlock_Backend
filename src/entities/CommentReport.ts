import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Comment } from './Comment';
import { User } from './User';

/** Why a listener flagged a comment (Issue #411). */
export enum CommentReportReason {
  HARASSMENT = 'harassment',
  SPAM = 'spam',
  HATE_SPEECH = 'hate_speech',
  INAPPROPRIATE = 'inappropriate',
  OTHER = 'other',
}

/** Lifecycle of a comment report in the moderation queue. */
export enum CommentReportStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
}

/** What the moderator did about the flagged comment. */
export enum CommentReportAction {
  NO_ACTION = 'no_action',
  COMMENT_FLAGGED = 'comment_flagged',
  COMMENT_REMOVED = 'comment_removed',
  DISMISSED = 'dismissed',
}

/**
 * A user-submitted report against a comment (Issue #411).
 *
 * Comment reports surface directly in the existing moderation review flow,
 * carrying full comment context (the comment text and the parent thread). The
 * `(commentId, reporterId)` unique constraint ensures a single account cannot
 * file duplicate reports against the same comment.
 */
@Entity('comment_reports')
@Unique('UQ_comment_report_reporter_comment', ['commentId', 'reporterId'])
export class CommentReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment!: Comment;

  @Index()
  @Column()
  commentId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterId' })
  reporter!: User;

  @Index()
  @Column()
  reporterId!: string;

  @Column({ type: 'varchar', default: CommentReportReason.OTHER })
  reason!: CommentReportReason;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Index()
  @Column({ type: 'varchar', default: CommentReportStatus.PENDING })
  status!: CommentReportStatus;

  @Column({ type: 'varchar', nullable: true })
  actionTaken?: CommentReportAction | null;

  /** Moderator who resolved the report. */
  @Column({ nullable: true })
  resolvedBy?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
