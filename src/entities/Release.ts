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

export enum ReleaseType {
  ALBUM = 'album',
  EP = 'ep',
  SINGLE = 'single',
}

export enum ReleaseStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  PUBLISHED = 'published',
}

@Entity('releases')
@Index(['status', 'scheduledAt'])
export class Release {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artistId' })
  artist!: User;

  @Column()
  artistId!: string;

  @Column({ type: 'timestamp' })
  releaseDate!: Date;

  @Column({ type: 'varchar', default: ReleaseType.ALBUM })
  type!: ReleaseType;

  @Column({
    type: 'varchar',
    length: 50,
    default: ReleaseStatus.PUBLISHED,
  })
  status!: ReleaseStatus;

  /**
   * Future timestamp when the release should automatically be published (Issue #423).
   */
  @Column({ type: 'timestamp', nullable: true })
  scheduledAt?: Date | null;

  /**
   * Timestamp when the release became publicly live/published.
   */
  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ nullable: true })
  coverArt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
