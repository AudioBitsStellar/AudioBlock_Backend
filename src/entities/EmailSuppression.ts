import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

/** Why an address was suppressed. Mirrors the provider events we act on. */
export enum EmailSuppressionReason {
  /** Permanent (hard) bounce: the mailbox does not exist or rejected mail for good. */
  BOUNCE = 'bounce',
  /** The recipient marked a previous message as spam. */
  COMPLAINT = 'complaint',
  /** The provider itself refused to send and reported the address as dropped. */
  PROVIDER_DROP = 'provider_drop',
}

/**
 * Addresses that must never receive transactional email again (issue PROD-03).
 *
 * Rows are written by the provider event webhook (`POST /api/email-events/:secret`)
 * and checked by the `email.send` job before every send. Emails are stored
 * lower-cased so lookups are case-insensitive. See docs/EMAIL_DELIVERABILITY.md.
 */
@Entity('email_suppressions')
@Unique('UQ_email_suppressions_email', ['email'])
export class EmailSuppression {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 32 })
  reason!: EmailSuppressionReason;

  /** Provider that reported the event (`resend` or `sendgrid`). */
  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
