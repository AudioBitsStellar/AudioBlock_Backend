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
import { Genre } from './Genre';
import { TemplateSplit } from './RoyaltyTemplate';

@Entity('songs') // pluralize for convention
export class Song {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artistId' }) // foreign key column
  user!: User;

  @Column()
  artistId!: string;

  @Column()
  coverArtPath!: string;

  @Column({ nullable: true })
  coverArtIpfsHash!: string;

  @Column({ type: 'simple-json', nullable: true })
  coverArtThumbnails!: { [key: string]: string } | null;

  @Column()
  title!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({ nullable: true })
  genre!: string;

  @Column({ nullable: true })
  genreId!: string;

  @ManyToOne(() => Genre, (genre) => genre.songs, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'genreId' })
  genreEntity?: Genre;

  @Column({ nullable: true })
  artistAddress!: string;

  @Column({ nullable: true })
  s3OriginalUrl!: string;

  @Column({ nullable: true })
  hlsMasterUrl!: string;

  @Column({ nullable: true })
  ipfsCid!: string;

  @Column({ nullable: true })
  duration!: number;

  @Column({ nullable: true })
  loudness!: number; // LUFS

  @Column({ default: 'processing' })
  status!: 'processing' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  errorReason!: string | null;

  @Column({ default: 0 })
  playCount!: number;

  @Column({ nullable: true })
  metadataCid!: string;

  /** On-chain minting state, independent of streaming readiness above. */
  @Column({ default: 'not_minted' })
  mintStatus!: 'not_minted' | 'pending' | 'minted' | 'failed';

  /** song_id returned by the catalog Soroban contract once minting succeeds. */
  @Column({ nullable: true })
  onChainSongId?: string;

  /** token_id of the song NFT, minted by the catalog Soroban contract. */
  @Column({ nullable: true })
  onChainTokenId?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata: any;

  @Column({ nullable: true })
  composers?: string;

  @Column({ default: false })
  flagged!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  flaggedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  flaggedBy?: string | null;

  @Column({ type: 'text', nullable: true })
  flagReason?: string | null;

  @Column('simple-json', { nullable: true })
  royaltySplits?: TemplateSplit[];

  @Column({ type: 'text', nullable: true })
  lyrics?: string;

  @Column({ nullable: true })
  language?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
