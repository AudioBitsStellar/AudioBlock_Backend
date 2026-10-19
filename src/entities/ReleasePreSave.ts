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
import { Release } from './Release';

/**
 * A fan pre-saving an upcoming release (Issue #424).
 *
 * A pre-save records interest before `release.releaseDate` (publish time) and
 * is fulfilled on publish by copying the release's tracks into the fan's
 * library (`user_saves`). The `(userId, releaseId)` unique constraint makes
 * pre-saving idempotent — the same fan cannot pre-save the same release twice.
 */
@Entity('release_pre_saves')
@Unique('UQ_release_pre_save_user_release', ['userId', 'releaseId'])
export class ReleasePreSave {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'uuid' })
  releaseId!: string;

  @ManyToOne(() => Release, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'releaseId' })
  release!: Release;

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * When the pre-save was fulfilled into the fan's library on publish.
   * Null while the release is still upcoming.
   */
  @Column({ type: 'timestamp', nullable: true })
  fulfilledAt?: Date | null;
}
