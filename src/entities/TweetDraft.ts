import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * An AI-drafted tweet awaiting artist review (issue: "add drafting
 * assistance to twitterRoutes.ts, requiring explicit artist approval before
 * posting"). This only stores draft text for the artist to review/copy —
 * see src/routes/twitterRoutes.ts for why actual posting is out of scope:
 * Twitter access/refresh tokens are deliberately never persisted today.
 */
@Entity('tweet_drafts')
export class TweetDraft {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column({ nullable: true })
  songId?: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ default: 'pending_review' })
  status!: 'pending_review' | 'approved';

  @Column({ nullable: true })
  provider?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;
}
