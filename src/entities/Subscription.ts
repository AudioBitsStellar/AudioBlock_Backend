import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';

/**
 * Subscription tier levels for the platform.
 */
export enum SubscriptionTier {
  FREE = 'free',
  ARTIST_PRO = 'artist_pro',
  LABEL = 'label',
}

/**
 * Subscription status values.
 */
export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/**
 * Subscription entity representing a user's premium tier access.
 * Tracks subscription tier, status, and validity period.
 */
@Entity('subscriptions')
@Index(['userId'])
@Index(['status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: SubscriptionTier,
    default: SubscriptionTier.FREE,
  })
  tier!: SubscriptionTier;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;

  @Column({ type: 'timestamp' })
  startDate!: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate?: Date;

  /**
   * Optional end of the free-trial period. While set and in the future the
   * subscription grants its gated features WITHOUT being billed. When this
   * date passes the trial is finalised (see SubscriptionService), after which
   * the subscription is treated as a paid/billed subscription.
   */
  @Column({ type: 'timestamp', nullable: true })
  trialEndsAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
