import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One row per mutating request made to the admin API (#980).
 *
 * `actorId` deliberately has no foreign key: an audit entry must outlive the
 * account that produced it, and a request that failed authentication has no
 * actor at all (null).
 */
@Entity('admin_audit_logs')
@Index(['actorId', 'createdAt'])
@Index(['createdAt'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Authenticated admin who made the request. Null when the request was unauthenticated. */
  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  /** Request path without the query string, so resource ids are recorded. */
  @Column({ type: 'varchar', length: 500 })
  path!: string;

  /** HTTP status returned, so denied and failed attempts are visible too. */
  @Column({ type: 'int' })
  statusCode!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  /** Justification supplied in the request body, when one was given. */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
