import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';
import { Song } from './Song';

/** Maximum length of a comment body (Issue #90). */
export const COMMENT_MAX_LENGTH = 2000;

/** Maximum nesting depth: a top-level comment plus two levels of replies. */
export const COMMENT_MAX_DEPTH = 3;

/** Window, in minutes, during which an author may edit their own comment. */
export const COMMENT_EDIT_WINDOW_MINUTES = 15;

/**
 * Comment entity for song comments and reviews (Issue #90).
 *
 * Replies are modelled as a self-referencing parent link. `depth` is
 * denormalised so the nesting limit can be enforced with one read of the parent
 * instead of walking the whole ancestor chain on every insert.
 */
@Entity('comments')
@Index(['songId'])
@Index(['userId'])
@Index(['parentId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  songId!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Column({ type: 'text' })
  text!: string;

  /** Null for a top-level comment; otherwise the comment being replied to. */
  @Column({ type: 'uuid', nullable: true })
  parentId?: string | null;

  @ManyToOne(() => Comment, (comment) => comment.replies, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'parentId' })
  parent?: Comment | null;

  @OneToMany(() => Comment, (comment) => comment.parent)
  replies?: Comment[];

  /** 1 for a top-level comment, up to {@link COMMENT_MAX_DEPTH}. */
  @Column({ type: 'int', default: 1 })
  depth!: number;

  /** True once the author has edited the body, so clients can show a marker. */
  @Column({ default: false })
  edited!: boolean;

  /** True once a moderator acted on a comment report (Issue #411). */
  @Column({ default: false })
  flagged!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  flaggedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  flagReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
