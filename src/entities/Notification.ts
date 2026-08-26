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

export type NotificationType =
  'royalty_payout' | 'song_status' | 'marketplace_sale' | 'comment' | 'follow' | 'system';

@Entity('notifications')
@Index(['userId', 'isRead'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'varchar',
    length: 50,
  })
  type!: NotificationType | string;

  @Column()
  title!: string;

  @Column('text')
  message!: string;

  @Column({ type: 'simple-json', nullable: true })
  data!: Record<string, any> | null;

  @Column({ default: false })
  isRead!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
