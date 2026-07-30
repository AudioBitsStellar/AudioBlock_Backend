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

/** Lifecycle of a verification application (Issue #92). */
export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** Maximum length of a single supporting link. */
export const VERIFICATION_LINK_MAX_LENGTH = 500;

/** Maximum number of links accepted per category. */
export const VERIFICATION_MAX_LINKS = 10;

/** Maximum length of an admin rejection reason. */
export const VERIFICATION_REASON_MAX_LENGTH = 500;

/**
 * An artist's application for a verification badge (Issue #92).
 *
 * A user may apply more than once over time (after a rejection), so history is
 * retained and the current badge state is derived from the latest approved row.
 */
@Entity('artist_verifications')
@Index(['userId'])
@Index(['status'])
export class ArtistVerification {
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
    default: VerificationStatus.PENDING,
  })
  status!: VerificationStatus;

  /** Legal or stage name the applicant claims, as evidence of identity. */
  @Column({ length: 200 })
  displayNameProof!: string;

  /**
   * Links to the applicant's social profiles.
   *
   * Stored as JSON rather than a comma-joined list because a URL may itself
   * contain a comma, which would corrupt a `simple-array` round-trip.
   */
  @Column('simple-json', { nullable: true })
  socialLinks!: string[];

  /** Links to the applicant's music on streaming or distribution platforms. */
  @Column('simple-json', { nullable: true })
  musicLinks!: string[];

  /** Free-form supporting context supplied by the applicant. */
  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** Admin who approved or rejected the application. */
  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date | null;

  /** Why the application was rejected. Required on rejection. */
  @Column({ type: 'text', nullable: true })
  rejectionReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
