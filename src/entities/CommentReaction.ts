import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './User';
import { Comment } from './Comment';

/**
 * Supported reaction types for comments.
 */
export enum ReactionType {
  LIKE = 'like',
  HEART = 'heart',
  FIRE = 'fire',
}

/**
 * A user's reaction to a comment (Issue #412).
 *
 * Enforces one reaction per type per user per comment via a unique constraint.
 * The reaction count is denormalised on the Comment entity for fast reads.
 */
@Entity('comment_reactions')
@Unique(['userId', 'commentId', 'type'])
@Index(['commentId'])
@Index(['userId'])
export class CommentReaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  commentId!: string;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment!: Comment;

  @Column({ type: 'enum', enum: ReactionType })
  type!: ReactionType;

  @CreateDateColumn()
  createdAt!: Date;
}
