import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

export enum ApiKeyScope {
  READ_ONLY = 'read-only',
  UPLOAD = 'upload',
  ADMIN = 'admin',
}

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  name!: string;

  @Column({ unique: true })
  keyHash!: string;

  @Column({ type: 'simple-array', default: '' })
  scopes!: ApiKeyScope[];

  /**
   * Rate-limit tier for the API key (e.g., standard, high, unlimited).
   */
  @Column({ length: 50, default: 'standard' })
  rateLimitTier!: string;

  /**
   * Permission strings granted to this key. A key can never exceed the
   * permissions its owning user's role holds — that is enforced at issue time
   * and re-checked on every request.
   */
  @Column('simple-array', { default: '' })
  permissions!: string[];

  @Column({ default: false })
  isRevoked!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
