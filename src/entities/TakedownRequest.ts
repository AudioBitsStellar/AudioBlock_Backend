import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";
import { Song } from "./Song";

export enum TakedownStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  REVERSED = "reversed",
}

export enum TakedownReason {
  COPYRIGHT = "copyright",
  TRADEMARK = "trademark",
  OTHER = "other",
}

/**
 * Dedicated takedown-request model distinct from general ContentReport/moderation flagging.
 * Tracks copyright takedown lifecycle separately and supports reversible unpublishing.
 */
@Entity("takedown_requests")
export class TakedownRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  songId!: string;

  @ManyToOne(() => Song, { onDelete: "CASCADE" })
  @JoinColumn({ name: "songId" })
  song!: Song;

  /** User who filed the takedown (could be rights holder or admin filing on behalf) */
  @Column()
  requestedBy!: string;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "requestedBy" })
  requester!: User;

  @Column({ type: "enum", enum: TakedownReason, default: TakedownReason.COPYRIGHT })
  reason!: TakedownReason;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** Detailed evidence / reference URL */
  @Column({ type: "text", nullable: true })
  evidenceUrl!: string | null;

  @Column({ type: "enum", enum: TakedownStatus, default: TakedownStatus.PENDING })
  status!: TakedownStatus;

  /** Admin who reviewed/resolved */
  @Column({ nullable: true })
  reviewedBy!: string | null;

  @Column({ type: "text", nullable: true })
  reviewNotes!: string | null;

  /** Snapshot of song flagged state before takedown (for reversible unpublish) */
  @Column({ default: false })
  previousFlagged!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  resolvedAt!: Date | null;
}
