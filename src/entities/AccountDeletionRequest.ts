import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Status of a GDPR account-deletion request (Issue #633, Art. 12/17).
 *
 * `requested` → the user asked; `cancelled` → they took it back inside the grace
 * window; `completed` → erasure ran; `failed` → erasure was attempted and did not
 * finish, so it is retried.
 */
export type AccountDeletionStatus = 'requested' | 'cancelled' | 'completed' | 'failed';

/**
 * An append-only audit trail of account-deletion requests.
 *
 * GDPR Art. 5(2) requires a controller to be able to *demonstrate* compliance,
 * and Art. 30 requires a record of processing activities. A flag on the user row
 * cannot show that: if the row is later purged or the DB is restored from a
 * stale backup, the evidence of what was erased and when disappears. This table
 * deliberately holds only non-identifying references — the user id and an
 * opaque request id, never the email, name, or IP that triggered the request.
 */
@Entity('account_deletion_requests')
@Index('IDX_account_deletion_status', ['status'])
@Index('IDX_account_deletion_userId', ['userId'])
export class AccountDeletionRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The account this request concerns. Intentionally not a foreign key. */
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', default: "'requested'" })
  status!: AccountDeletionStatus;

  /**
   * Opaque correlation id surfaced to the user and support, so a data-subject
   * access request can be traced to this row without exposing the account.
   */
  @Column({ type: 'uuid' })
  referenceId!: string;

  /** When the user submitted the request. */
  @Column({ type: 'timestamp' })
  requestedAt!: Date;

  /** End of the grace window during which the request can be cancelled. */
  @Column({ type: 'timestamp' })
  gracePeriodEndsAt!: Date;

  /** When the erasure actually ran, if it has. */
  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  /** Whether the user downloaded their data export before deletion completed. */
  @Column({ type: 'boolean', default: false })
  dataExported!: boolean;

  /**
   * Outcome of the best-effort attempt to delete the linked Privy identity.
   * `'skipped'` means the account was never linked to Privy.
   */
  @Column({ type: 'varchar', nullable: true })
  privyDeletionStatus?: 'succeeded' | 'failed' | 'skipped';

  /**
   * Operator-facing notes. Must never contain personal data — this table
   * outlives the erasure and is the one place a leak would be durable.
   */
  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
