import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("songs") // pluralize for convention
export class Song {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "artistId" }) // foreign key column
  user!: User;

  @Column()
  artistId!: string; 

  @Column()
  coverArtPath!: string; 

  @Column()
  title!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({ nullable: true })
  genre!: string;

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

  @Column({ default: "processing" })
  status!: "processing" | "ready" | "failed";

  @Column({ default: 0 })
  playCount!: number;

  @Column({ nullable: true })
  metadataCid!: string;

  /** On-chain minting state, independent of streaming readiness above. */
  @Column({ default: "not_minted" })
  mintStatus!: "not_minted" | "pending" | "minted" | "failed";

  /** song_id returned by the catalog Soroban contract once minting succeeds. */
  @Column({ nullable: true })
  onChainSongId?: string;

  /** token_id of the song NFT, minted by the catalog Soroban contract. */
  @Column({ nullable: true })
  onChainTokenId?: string;

  @Column({ type: "json", nullable: true })
  metadata: any;

  @Column({ nullable: true })
  composers?: string;

  @Column({ default: false })
  flagged!: boolean;

  @Column({ type: "timestamp", nullable: true })
  flaggedAt!: Date | null;

  @Column({ nullable: true })
  flaggedBy!: string | null;

  @Column({ type: "text", nullable: true })
  flagReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
