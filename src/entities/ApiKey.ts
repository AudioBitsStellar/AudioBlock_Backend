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
 * API key entity for third-party integrations (Issue #89).
 *
 * Only the SHA-256 hash of a key is persisted; the raw key is returned to the
 * owner once at creation and is unrecoverable afterwards. `keyPrefix` exists so
 * a key can be identified in a list without exposing the secret.
 */
@Entity('api_keys')
@Index(['userId'])
@Index(['keyHash'], { unique: true })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** Human-readable label chosen by the owner, e.g. "Partner dashboard". */
  @Column({ length: 100 })
  name!: string;

  /** SHA-256 hash of the raw key. Never returned by the API. */
  @Column({ unique: true })
  keyHash!: string;

  /** Non-secret display prefix, e.g. `abk_1a2b3c4d`. */
  @Column({ length: 32 })
  keyPrefix!: string;

  /**
   * Permission strings granted to this key. A key can never exceed the
   * permissions its owning user's role holds — that is enforced at issue time
   * and re-checked on every request.
   */
  @Column('simple-array', { default: '' })
  permissions!: string[];

  /** Set when the key is revoked; a revoked key never authenticates again. */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  /** Last time this key successfully authenticated a request. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
