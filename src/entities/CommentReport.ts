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
} from "typeorm";
import { User } from "./User";
import { Comment } from "./Comment";

export enum CommentReportReason {
  SPAM = "spam",
  HARASSMENT = "harassment",
  INAPPROPRIATE = "inappropriate",
  COPYRIGHT = "copyright",
  OTHER = "other",
}

export enum CommentReportStatus {
  PENDING = "pending",
  RESOLVED = "resolved",
}

export enum CommentReportAction {
  NO_ACTION = "no_action",
  COMMENT_HIDDEN = "comment_hidden",
  COMMENT_REMOVED = "comment_removed",
  USER_WARNED = "user_warned",
  USER_SUSPENDED = "user_suspended",
  DISMISSED = "dismissed",
}

/**
 * Comment flagging integrated into moderation queue (Issue #411).
 *
 * When a user flags a comment, it creates a report that appears in the
 * moderation queue alongside song ContentReports. Moderators can review,
 * hide, remove, or take action against the commenter.
 */
@Entity("comment_reports")
@Unique("UQ_comment_report_user_comment", ["commentId", "reporterId"])
@Index(["commentId"])
@Index(["reporterId"])
@Index(["status"])
export class CommentReport {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  commentId!: string;

  @ManyToOne(() => Comment, { onDelete: "CASCADE" })
  @JoinColumn({ name: "commentId" })
  comment!: Comment;

  @Column({ type: "uuid" })
  reporterId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "reporterId" })
  reporter!: User;

  @Column({ type: "varchar", default: CommentReportReason.OTHER })
  reason!: CommentReportReason;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "varchar", default: CommentReportStatus.PENDING })
  status!: CommentReportStatus;

  @Column({ type: "varchar", nullable: true })
  actionTaken?: CommentReportAction | null;

  @Column({ nullable: true })
  resolvedBy?: string | null;

  @Column({ type: "timestamp", nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  resolutionNote?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
