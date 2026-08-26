import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Song } from './Song';

/**
 * A revision of a song (Issue #86).
 *
 * Every upload produces a version row: the original upload is version 1, and
 * each re-upload appends a new version instead of overwriting the previous
 * audio. Exactly one version per song carries `isActive = true` — that is the
 * revision currently served for streaming. Older versions keep their IPFS CID
 * and S3 URL so royalty calculations tied to a specific revision stay valid.
 */
@Entity('song_versions')
@Unique('UQ_song_version_number', ['songId', 'versionNumber'])
export class SongVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Index()
  @Column()
  songId!: string;

  /** 1-based revision counter, unique per song. */
  @Column({ type: 'int' })
  versionNumber!: number;

  /** True for the revision currently served. Only one per song. */
  @Index()
  @Column({ default: false })
  isActive!: boolean;

  @Column({ nullable: true })
  title?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  genre?: string;

  @Column({ nullable: true })
  composers?: string;

  @Column({ nullable: true })
  coverArtPath?: string;

  @Column({ nullable: true })
  s3OriginalUrl?: string;

  @Column({ nullable: true })
  hlsMasterUrl?: string;

  /** Preserved per-version so previous audio remains retrievable from IPFS. */
  @Column({ nullable: true })
  ipfsCid?: string;

  @Column({ nullable: true })
  metadataCid?: string;

  @Column({ type: 'int', nullable: true })
  duration?: number;

  @Column({ type: 'float', nullable: true })
  loudness?: number;

  @Column({ default: 'processing' })
  status!: 'processing' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  errorReason?: string | null;

  /** Artist-supplied note describing what changed in this revision. */
  @Column({ type: 'text', nullable: true })
  changeNote?: string | null;

  /** User who created this revision (the uploading artist). */
  @Column({ nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
