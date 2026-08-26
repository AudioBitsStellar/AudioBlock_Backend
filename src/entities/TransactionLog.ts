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

@Entity('transactions_logs') // pluralize for convention
export class TransactionLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' }) // foreign key column
  user!: User;

  @Column()
  user_id!: string;

  @Column()
  txHash!: string;

  @Column()
  action!: string;

  @Column({ nullable: true })
  description?: string;

  /** Transaction amount for wallet balance history (Issue #84). */
  @Column('decimal', { precision: 18, scale: 6, nullable: true })
  amount?: number;

  /** Associated entity ID (song, album, etc.) for context (Issue #84). */
  @Column({ nullable: true })
  relatedEntityId?: string;

  /** Type of the related entity: 'song' | 'album' | 'payout' | 'purchase' (Issue #84). */
  @Column({ nullable: true })
  relatedEntityType?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
