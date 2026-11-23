import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Song } from './Song';

export enum TakedownStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVERSED = 'reversed',
}

export enum TakedownReason {
  COPYRIGHT = 'copyright',
  TRADEMARK = 'trademark',
  OTHER = 'other',
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Time an admin has to decide a pending takedown before it is overdue (#981). */
export const TAKEDOWN_REVIEW_SLA_MS = 3 * DAY_MS;

/** Time after approval in which the artist may file a counter-notice (#981). */
export const TAKEDOWN_COUNTER_NOTICE_WINDOW_MS = 14 * DAY_MS;

/** Maximum length of an artist's counter-notice statement. */
export const TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH = 5000;

/**
 * Dedicated takedown-request model distinct from general ContentReport/moderation flagging.
 * Tracks copyright takedown lifecycle separately and supports reversible unpublishing.
 */
@Entity('takedown_requests')
export class TakedownRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  songId!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  /** User who filed the takedown (could be rights holder or admin filing on behalf) */
  @Column()
  requestedBy!: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'requestedBy' })
  requester!: User;

  @Column({ type: 'enum', enum: TakedownReason, default: TakedownReason.COPYRIGHT })
  reason!: TakedownReason;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Detailed evidence / reference URL */
  @Column({ type: 'text', nullable: true })
  evidenceUrl!: string | null;

  @Column({ type: 'enum', enum: TakedownStatus, default: TakedownStatus.PENDING })
  status!: TakedownStatus;

  /** Admin who reviewed/resolved */
  @Column({ type: 'varchar', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reviewNotes!: string | null;

  /** Snapshot of song flagged state before takedown (for reversible unpublish) */
  @Column({ default: false })
  previousFlagged!: boolean;

  /**
   * Deadline by which an admin should decide a pending request (#981). Null for
   * requests filed before deadlines existed, which are never reported as overdue.
   */
  @Column({ type: 'timestamp', nullable: true })
  reviewDueAt!: Date | null;

  /**
   * Deadline for the artist's counter-notice, set when the takedown is approved
   * (#981). Null while pending, rejected, or filed before deadlines existed.
   */
  @Column({ type: 'timestamp', nullable: true })
  counterNoticeDueAt!: Date | null;

  /** Statement filed by the artist disputing the takedown (#981). */
  @Column({ type: 'text', nullable: true })
  counterNotice!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  counterNoticeAt!: Date | null;

  /** Artist who filed the counter-notice. */
  @Column({ type: 'varchar', nullable: true })
  counterNoticeBy!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt!: Date | null;
}
