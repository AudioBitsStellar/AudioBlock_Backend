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
import { User } from './User';
import { NotificationType } from './Notification';

/**
 * Per-user notification preference settings (Issue #427).
 *
 * Allows users to opt in or out of specific notification types.
 * If a preference row doesn't exist for a user and type, notifications default to enabled.
 */
@Entity('notification_preferences')
@Unique(['userId', 'type'])
@Index(['userId', 'type'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'varchar',
    length: 50,
  })
  type!: NotificationType | string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
