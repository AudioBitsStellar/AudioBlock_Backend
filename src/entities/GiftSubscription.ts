import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';
import { SubscriptionTier } from './Subscription';

export enum GiftStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

@Entity('gift_subscriptions')
@Index(['recipientId'])
@Index(['senderId'])
@Index(['status'])
export class GiftSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  senderId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderId' })
  sender!: User;

  @Column({ type: 'uuid' })
  recipientId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientId' })
  recipient!: User;

  @Column({ type: 'enum', enum: SubscriptionTier })
  tier!: SubscriptionTier;

  /** Duration in days; null = until sender cancels or recipient declines. */
  @Column({ type: 'int', nullable: true })
  durationDays?: number | null;

  /** Optional personal message from sender. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  message?: string | null;

  @Column({
    type: 'enum',
    enum: GiftStatus,
    default: GiftStatus.PENDING,
  })
  status!: GiftStatus;

  @Column({ type: 'timestamp', nullable: true })
  redeemedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
